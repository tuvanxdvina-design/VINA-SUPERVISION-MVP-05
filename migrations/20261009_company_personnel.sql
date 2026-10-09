BEGIN;
CREATE TABLE IF NOT EXISTS company_personnel (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
 full_name varchar(255) NOT NULL, notes text NOT NULL DEFAULT '', deleted_at timestamptz,
 merged_into uuid REFERENCES company_personnel(id), created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS personnel_certificates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), personnel_id uuid NOT NULL REFERENCES company_personnel(id),
 certificate_type varchar(120) NOT NULL, certificate_number varchar(255), grade varchar(80), field varchar(255),
 issued_on date, expires_on date, issuer varchar(255), deleted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
 CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);
CREATE TABLE IF NOT EXISTS personnel_certificate_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), certificate_id uuid NOT NULL REFERENCES personnel_certificates(id),
 file_name varchar(255) NOT NULL, file_type varchar(120), file_size bigint NOT NULL,
 sha256 char(64) NOT NULL, storage_key varchar(180) NOT NULL, uploaded_by uuid REFERENCES users(id),
 uploaded_at timestamptz NOT NULL DEFAULT NOW(), deleted_at timestamptz, UNIQUE(certificate_id,sha256)
);
CREATE TABLE IF NOT EXISTS personnel_imports (
 source_personnel_id uuid PRIMARY KEY, profile_id uuid NOT NULL REFERENCES company_personnel(id), source_data jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS personnel_merge_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_id uuid NOT NULL REFERENCES company_personnel(id),
 target_id uuid NOT NULL REFERENCES company_personnel(id), reason text NOT NULL,
 status varchar(20) NOT NULL CHECK(status IN ('MERGED','REJECTED','UNDONE')),
 before_data jsonb NOT NULL DEFAULT '{}'::jsonb, decided_by uuid NOT NULL REFERENCES users(id), decided_at timestamptz NOT NULL DEFAULT NOW(),
 undone_by uuid REFERENCES users(id), undone_at timestamptz
);
ALTER TABLE project_personnel ADD COLUMN IF NOT EXISTS personnel_profile_id uuid REFERENCES company_personnel(id);
-- A shared account is the ONLY automatic identity match. Unlinked legacy rows remain separate.
INSERT INTO company_personnel(id,user_id,full_name)
 SELECT DISTINCT ON (COALESCE(user_id::text,id::text))
 md5(CASE WHEN user_id IS NULL THEN 'personnel:'||id::text ELSE 'user:'||user_id::text END)::uuid,
 user_id, full_name FROM project_personnel WHERE personnel_profile_id IS NULL
 ORDER BY COALESCE(user_id::text,id::text),updated_at DESC,id
 ON CONFLICT DO NOTHING;
INSERT INTO personnel_imports(source_personnel_id,profile_id,source_data)
 SELECT pp.id,cp.id,to_jsonb(pp) FROM project_personnel pp JOIN company_personnel cp
 ON (pp.user_id IS NOT NULL AND cp.user_id=pp.user_id) OR (pp.user_id IS NULL AND cp.id=md5('personnel:'||pp.id::text)::uuid)
 WHERE pp.personnel_profile_id IS NULL ON CONFLICT DO NOTHING;
UPDATE project_personnel pp SET personnel_profile_id=i.profile_id FROM personnel_imports i
 WHERE pp.id=i.source_personnel_id AND pp.personnel_profile_id IS NULL;
INSERT INTO personnel_certificates(id,personnel_id,certificate_type,certificate_number)
 SELECT DISTINCT md5(i.profile_id::text||':legacy:'||COALESCE(trim(i.source_data->>'certificate'),''))::uuid,
 i.profile_id,'Chứng chỉ cũ',NULLIF(trim(i.source_data->>'certificate'),'') FROM personnel_imports i
 WHERE NULLIF(trim(i.source_data->>'certificate'),'') IS NOT NULL OR EXISTS(SELECT 1 FROM project_personnel_files f WHERE f.personnel_id=i.source_personnel_id)
 ON CONFLICT DO NOTHING;
INSERT INTO personnel_certificate_files(id,certificate_id,file_name,file_type,file_size,sha256,storage_key,uploaded_by,uploaded_at)
 SELECT f.id,md5(i.profile_id::text||':legacy:'||COALESCE(trim(i.source_data->>'certificate'),''))::uuid,
 f.file_name,f.file_type,f.file_size,f.sha256,f.storage_key,f.uploaded_by,f.uploaded_at
 FROM project_personnel_files f JOIN personnel_imports i ON i.source_personnel_id=f.personnel_id ON CONFLICT DO NOTHING;
UPDATE project_personnel SET certificate=NULL WHERE certificate IS NOT NULL;
-- The original text/files survive in imports/central storage; new writes never store certificates per project.
ALTER TABLE project_personnel DROP CONSTRAINT IF EXISTS project_personnel_project_id_full_name_key;
DROP INDEX IF EXISTS uq_project_personnel_active_name;
CREATE INDEX IF NOT EXISTS idx_personnel_profile ON project_personnel(personnel_profile_id);
-- One active assignment per company profile per project (the name-based unique key was dropped above).
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_personnel_active_profile ON project_personnel(project_id, personnel_profile_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_certificate_expiry ON personnel_certificates(expires_on) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION company_personnel_project_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile company_personnel; legacy_id uuid;
BEGIN
 IF NEW.personnel_profile_id IS NULL THEN
  IF NEW.user_id IS NOT NULL THEN SELECT * INTO profile FROM company_personnel WHERE user_id=NEW.user_id; END IF;
  IF profile.id IS NULL THEN
   INSERT INTO company_personnel(user_id,full_name) VALUES(NEW.user_id,NEW.full_name) RETURNING * INTO profile;
  END IF;
  NEW.personnel_profile_id:=profile.id;
 ELSE
  SELECT * INTO profile FROM company_personnel WHERE id=NEW.personnel_profile_id FOR UPDATE;
  IF profile.id IS NULL OR profile.deleted_at IS NOT NULL OR profile.merged_into IS NOT NULL THEN RAISE EXCEPTION 'Inactive company personnel' USING ERRCODE='P2001'; END IF;
  IF NEW.user_id IS NOT NULL AND profile.user_id IS DISTINCT FROM NEW.user_id THEN
   IF profile.user_id IS NOT NULL THEN RAISE EXCEPTION 'Profile belongs to another account' USING ERRCODE='P2001'; END IF;
   UPDATE company_personnel SET user_id=NEW.user_id,updated_at=NOW() WHERE id=profile.id;
  END IF;
 END IF;
 IF profile.deleted_at IS NOT NULL OR profile.merged_into IS NOT NULL THEN RAISE EXCEPTION 'Inactive company personnel' USING ERRCODE='P2001'; END IF;
 -- Legacy APIs may still send a certificate string; convert it once into central data.
 IF TG_OP='INSERT' AND NULLIF(trim(NEW.certificate),'') IS NOT NULL THEN
  legacy_id:=md5(NEW.personnel_profile_id::text||':legacy:'||trim(NEW.certificate))::uuid;
  INSERT INTO personnel_certificates(id,personnel_id,certificate_type,certificate_number)
  VALUES(legacy_id,NEW.personnel_profile_id,'Chứng chỉ cũ',trim(NEW.certificate)) ON CONFLICT DO NOTHING;
 END IF;
 NEW.certificate:=NULL;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS company_personnel_project_link ON project_personnel;
CREATE TRIGGER company_personnel_project_link BEFORE INSERT OR UPDATE ON project_personnel
 FOR EACH ROW EXECUTE FUNCTION company_personnel_project_link();

CREATE TABLE IF NOT EXISTS certificate_submission_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type varchar(30) NOT NULL, entity_id uuid NOT NULL,
 captured_at timestamptz NOT NULL DEFAULT NOW(), captured_by uuid REFERENCES users(id), snapshot jsonb NOT NULL
);
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS personnel_certificate_snapshot jsonb;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS certificate_snapshot_by uuid REFERENCES users(id);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS personnel_certificate_snapshot jsonb;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS personnel_certificate_snapshot jsonb;
CREATE OR REPLACE FUNCTION capture_personnel_certificates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE payload jsonb; actor uuid; snapshot_id uuid;
BEGIN
 IF (TG_TABLE_NAME IN ('daily_logs','documents') AND OLD.status='DRAFT' AND NEW.status IN ('SUBMITTED','APPROVED'))
 OR (TG_TABLE_NAME='issues' AND OLD.status<>'RESOLVED' AND NEW.status='RESOLVED') THEN
  IF TG_TABLE_NAME='issues' THEN
   IF COALESCE(NEW.details->>'documentType','')<>'MINUTES' AND COALESCE(NEW.source_type,'') NOT ILIKE '%biên%' THEN RETURN NEW; END IF;
  END IF;
  snapshot_id:=gen_random_uuid();
  IF TG_TABLE_NAME='daily_logs' THEN actor:=COALESCE(NEW.certificate_snapshot_by,NEW.approved_by,NEW.created_by);
  ELSIF TG_TABLE_NAME='documents' THEN actor:=COALESCE(NEW.submitted_by,NEW.created_by);
  ELSE actor:=COALESCE(NEW.resolved_by,NEW.created_by); END IF;
  SELECT jsonb_build_object('snapshot_id',snapshot_id,'captured_at',NOW(),'captured_by',actor,'personnel',COALESCE(jsonb_agg(person),'[]'::jsonb)) INTO payload
  FROM (SELECT DISTINCT cp.id AS profile_id,cp.full_name,pp.assignment_title,
   (SELECT COALESCE(jsonb_agg(to_jsonb(c)||jsonb_build_object('files',
     (SELECT COALESCE(jsonb_agg(to_jsonb(f)),'[]'::jsonb) FROM personnel_certificate_files f WHERE f.certificate_id=c.id AND f.deleted_at IS NULL))),'[]'::jsonb)
    FROM personnel_certificates c WHERE c.personnel_id=cp.id AND c.deleted_at IS NULL) AS certificates
   FROM project_personnel pp JOIN company_personnel cp ON cp.id=pp.personnel_profile_id
   WHERE pp.project_id=NEW.project_id AND pp.status='ACTIVE' AND cp.deleted_at IS NULL AND cp.merged_into IS NULL) person;
  NEW.personnel_certificate_snapshot:=payload;
  INSERT INTO certificate_submission_snapshots(id,entity_type,entity_id,captured_by,snapshot) VALUES(snapshot_id,TG_TABLE_NAME,NEW.id,actor,payload);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS capture_personnel_certificates ON daily_logs;
CREATE TRIGGER capture_personnel_certificates BEFORE UPDATE OF status ON daily_logs FOR EACH ROW EXECUTE FUNCTION capture_personnel_certificates();
DROP TRIGGER IF EXISTS capture_personnel_certificates ON documents;
CREATE TRIGGER capture_personnel_certificates BEFORE UPDATE OF status ON documents FOR EACH ROW EXECUTE FUNCTION capture_personnel_certificates();
DROP TRIGGER IF EXISTS capture_personnel_certificates ON issues;
CREATE TRIGGER capture_personnel_certificates BEFORE UPDATE OF status ON issues FOR EACH ROW EXECUTE FUNCTION capture_personnel_certificates();
COMMIT;
