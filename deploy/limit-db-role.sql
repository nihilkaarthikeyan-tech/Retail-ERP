-- Copyright (c) 2026, Rademics. All rights reserved.
-- Audit 1 #18 (owner, 28 October 2026): the API stops connecting as the database superuser.
-- A new ordinary login, retail_erp_owner, owns the Retail ERP tables (so migrations still run) but has
-- no superuser, database-creating or role-creating rights. Shop requests still switch to the limited
-- retail_erp_app role (row-level security). Run once as the superuser: psql -v pw="'...'" -f this file.
\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retail_erp_owner') THEN
    CREATE ROLE retail_erp_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE retail_erp_owner PASSWORD :pw;
-- Audit 8: the "contains" search index needs pg_trgm, which only the superuser may switch on.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
GRANT retail_erp_app TO retail_erp_owner;
GRANT CONNECT, TEMPORARY ON DATABASE :"DBNAME" TO retail_erp_owner;
ALTER SCHEMA public OWNER TO retail_erp_owner;

-- Every table, view, sequence, function and type of the public schema now belongs to it.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') LOOP
    EXECUTE format('ALTER %s public.%I OWNER TO retail_erp_owner', CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' ELSE 'TABLE' END, r.relname);
  END LOOP;
  -- Sequences that belong to a column move with their table; the rest are moved here.
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S' AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')) LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO retail_erp_owner', r.relname);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' LOOP
    EXECUTE format('ALTER ROUTINE %s OWNER TO retail_erp_owner', r.sig);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'c') AND NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.reltype = t.oid) LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO retail_erp_owner', r.typname);
  END LOOP;
END $$;

-- Tables made by later migrations (now run as retail_erp_owner) are open to the app role as before.
ALTER DEFAULT PRIVILEGES FOR ROLE retail_erp_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO retail_erp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE retail_erp_owner IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO retail_erp_app;
COMMIT;
