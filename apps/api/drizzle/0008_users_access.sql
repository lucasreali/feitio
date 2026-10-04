-- Users are platform rows, like tenants: the owner of the tables writes them
-- and the application role only reads them, to sign users in.
GRANT SELECT ON TABLE users TO feitio_app;
