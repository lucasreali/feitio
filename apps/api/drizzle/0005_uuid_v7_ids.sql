-- Entity ids are UUID v7 (time-ordered). PostgreSQL 17 has no built-in
-- uuidv7() (it arrives in 18), so this builds one from gen_random_uuid():
-- the first 48 bits become the Unix time in milliseconds and the version
-- bits become 7. The variant bits already come right from gen_random_uuid().
CREATE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
	SELECT encode(
		set_bit(
			set_bit(
				overlay(
					uuid_send(gen_random_uuid())
					PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
					FROM 1 FOR 6
				),
				52, 1
			),
			53, 1
		),
		'hex'
	)::uuid
$$;--> statement-breakpoint
-- Only the database roles that create rows call it.
REVOKE ALL ON FUNCTION uuid_generate_v7() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION uuid_generate_v7() TO feitio_app;--> statement-breakpoint
-- New tenants must have a UUID v7 id. NOT VALID leaves the rows created
-- before this rule (version 4 ids) as they are.
ALTER TABLE tenants ADD CONSTRAINT tenants_id_uuid_v7 CHECK (coalesce(uuid_extract_version(id), 0) = 7) NOT VALID;
