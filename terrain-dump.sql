--
-- PostgreSQL database dump
--

\restrict h8m7ViWkimaoooY4SSoi5Tes5CGdEUPzQiwghn6wnjccxlqZ8PM9RHxCm3Q4NUh

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.deployments DROP CONSTRAINT IF EXISTS deployments_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.conversions DROP CONSTRAINT IF EXISTS conversions_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;
DROP INDEX IF EXISTS public.users_email_key;
DROP INDEX IF EXISTS public.deployments_user_id_idx;
DROP INDEX IF EXISTS public.deployments_created_at_idx;
DROP INDEX IF EXISTS public.conversions_user_id_idx;
DROP INDEX IF EXISTS public.conversions_created_at_idx;
DROP INDEX IF EXISTS public.audit_logs_user_id_idx;
DROP INDEX IF EXISTS public.audit_logs_created_at_idx;
DROP INDEX IF EXISTS public.audit_logs_action_idx;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_pkey;
ALTER TABLE IF EXISTS ONLY public.deployments DROP CONSTRAINT IF EXISTS deployments_pkey;
ALTER TABLE IF EXISTS ONLY public.conversions DROP CONSTRAINT IF EXISTS conversions_pkey;
ALTER TABLE IF EXISTS ONLY public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_pkey;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.deployments;
DROP TABLE IF EXISTS public.conversions;
DROP TABLE IF EXISTS public.audit_logs;
DROP TYPE IF EXISTS public."Role";
--
-- Name: Role; Type: TYPE; Schema: public; Owner: terrain
--

CREATE TYPE public."Role" AS ENUM (
    'VIEWER',
    'CONVERTER',
    'DEPLOYER',
    'ADMIN'
);


ALTER TYPE public."Role" OWNER TO terrain;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: terrain
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    user_id text,
    action text NOT NULL,
    details jsonb,
    ip text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO terrain;

--
-- Name: conversions; Type: TABLE; Schema: public; Owner: terrain
--

CREATE TABLE public.conversions (
    id text NOT NULL,
    user_id text,
    bicep_filename text DEFAULT 'untitled.bicep'::text NOT NULL,
    bicep_content text NOT NULL,
    terraform_files jsonb NOT NULL,
    validation_passed boolean DEFAULT false NOT NULL,
    model text,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    total_cost_usd double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.conversions OWNER TO terrain;

--
-- Name: deployments; Type: TABLE; Schema: public; Owner: terrain
--

CREATE TABLE public.deployments (
    id text NOT NULL,
    user_id text,
    resource_group_name text NOT NULL,
    tests_passed integer DEFAULT 0 NOT NULL,
    tests_failed integer DEFAULT 0 NOT NULL,
    destroyed boolean DEFAULT false NOT NULL,
    total_cost_usd double precision DEFAULT 0 NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.deployments OWNER TO terrain;

--
-- Name: users; Type: TABLE; Schema: public; Owner: terrain
--

CREATE TABLE public.users (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    role public."Role" DEFAULT 'CONVERTER'::public."Role" NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.users OWNER TO terrain;

--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: terrain
--

COPY public.audit_logs (id, user_id, action, details, ip, created_at) FROM stdin;
\.


--
-- Data for Name: conversions; Type: TABLE DATA; Schema: public; Owner: terrain
--

COPY public.conversions (id, user_id, bicep_filename, bicep_content, terraform_files, validation_passed, model, input_tokens, output_tokens, total_cost_usd, status, created_at) FROM stdin;
\.


--
-- Data for Name: deployments; Type: TABLE DATA; Schema: public; Owner: terrain
--

COPY public.deployments (id, user_id, resource_group_name, tests_passed, tests_failed, destroyed, total_cost_usd, status, created_at) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: terrain
--

COPY public.users (id, email, name, role, created_at, updated_at) FROM stdin;
\.


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: terrain
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: conversions conversions_pkey; Type: CONSTRAINT; Schema: public; Owner: terrain
--

ALTER TABLE ONLY public.conversions
    ADD CONSTRAINT conversions_pkey PRIMARY KEY (id);


--
-- Name: deployments deployments_pkey; Type: CONSTRAINT; Schema: public; Owner: terrain
--

ALTER TABLE ONLY public.deployments
    ADD CONSTRAINT deployments_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: terrain
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_action_idx; Type: INDEX; Schema: public; Owner: terrain
--

CREATE INDEX audit_logs_action_idx ON public.audit_logs USING btree (action);


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: terrain
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at);


--
-- Name: audit_logs_user_id_idx; Type: INDEX; Schema: public; Owner: terrain
--

CREATE INDEX audit_logs_user_id_idx ON public.audit_logs USING btree (user_id);


--
-- Name: conversions_created_at_idx; Type: INDEX; Schema: public; Owner: terrain
--

CREATE INDEX conversions_created_at_idx ON public.conversions USING btree (created_at);


--
-- Name: conversions_user_id_idx; Type: INDEX; Schema: public; Owner: terrain
--

CREATE INDEX conversions_user_id_idx ON public.conversions USING btree (user_id);


--
-- Name: deployments_created_at_idx; Type: INDEX; Schema: public; Owner: terrain
--

CREATE INDEX deployments_created_at_idx ON public.deployments USING btree (created_at);


--
-- Name: deployments_user_id_idx; Type: INDEX; Schema: public; Owner: terrain
--

CREATE INDEX deployments_user_id_idx ON public.deployments USING btree (user_id);


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: terrain
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: terrain
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: conversions conversions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: terrain
--

ALTER TABLE ONLY public.conversions
    ADD CONSTRAINT conversions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: deployments deployments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: terrain
--

ALTER TABLE ONLY public.deployments
    ADD CONSTRAINT deployments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict h8m7ViWkimaoooY4SSoi5Tes5CGdEUPzQiwghn6wnjccxlqZ8PM9RHxCm3Q4NUh

