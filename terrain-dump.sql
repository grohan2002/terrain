--
-- PostgreSQL database dump
--

\restrict rce3qbchuKAn9UXDgN6kSUq4Ss2e1W65cN86lm0bHQbdlcjvVTaLz6aaYkuyX4N

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
cmo8gi7uk0001mu018d4bfg9k	\N	conversion.started	{"sourceFormat": "cloudformation", "contentLength": 13308}	192.168.65.1	2026-04-21 10:03:59.408
cmo8gnq5r0003mu01tr11tr93	\N	conversion.completed	{"sourceFormat": "cloudformation", "contentLength": 13308}	192.168.65.1	2026-04-21 10:08:16.355
\.


--
-- Data for Name: conversions; Type: TABLE DATA; Schema: public; Owner: terrain
--

COPY public.conversions (id, user_id, bicep_filename, bicep_content, terraform_files, validation_passed, model, input_tokens, output_tokens, total_cost_usd, status, created_at) FROM stdin;
cmo8gnq740004mu01f8s6lyqw	\N	cloudformation.json	\n  "AWSTemplateFormatVersion": "2010-09-09",\n  "Description": "AWS CloudFormation Sample Template Drupal_Single_Instance. Drupal is an open source content management platform powering millions of websites and applications. This template installs a singe instance deployment with a local MySQL database for storage. It uses the AWS CloudFormation bootstrap scripts to install packages and files at instance launch time. **WARNING** This template creates an Amazon EC2 instance. You will be billed for the AWS resources used if you create a stack from this template.",\n  "Parameters": {\n    "KeyName": {\n      "Description": "Name of an existing EC2 KeyPair to enable SSH access to the instances",\n      "Type": "String",\n      "MinLength": "1",\n      "MaxLength": "255",\n      "AllowedPattern": "[\\\\x20-\\\\x7E]*",\n      "ConstraintDescription": "can contain only ASCII characters."\n    },\n    "InstanceType": {\n      "Description": "WebServer EC2 instance type",\n      "Type": "String",\n      "Default": "m1.small",\n      "AllowedValues": [\n        "t1.micro",\n        "m1.small",\n        "m1.medium",\n        "m1.large",\n        "m1.xlarge",\n        "m2.xlarge",\n        "m2.2xlarge",\n        "m2.4xlarge",\n        "m3.xlarge",\n        "m3.2xlarge",\n        "c1.medium",\n        "c1.xlarge",\n        "cc1.4xlarge",\n        "cc2.8xlarge",\n        "cg1.4xlarge"\n      ],\n      "ConstraintDescription": "must be a valid EC2 instance type."\n    },\n    "SiteName": {\n      "Default": "My Site",\n      "Description": "The name of the Drupal Site",\n      "Type": "String"\n    },\n    "SiteEMail": {\n      "Description": "EMail for site adminitrator",\n      "Type": "String"\n    },\n    "SiteAdmin": {\n      "Description": "The Drupal site admin account username",\n      "Type": "String",\n      "MinLength": "1",\n      "MaxLength": "16",\n      "AllowedPattern": "[a-zA-Z][a-zA-Z0-9]*",\n      "ConstraintDescription": "must begin with a letter and contain only alphanumeric characters."\n    },\n    "SitePassword": {\n      "NoEcho": "true",\n      "Description": "The Drupal site admin account password",\n      "Type": "String",\n      "MinLength": "1",\n      "MaxLength": "41",\n      "AllowedPattern": "[a-zA-Z0-9]*",\n      "ConstraintDescription": "must contain only alphanumeric characters."\n    },\n    "DBName": {\n      "Default": "drupaldb",\n      "Description": "The Drupal database name",\n      "Type": "String",\n      "MinLength": "1",\n      "MaxLength": "64",\n      "AllowedPattern": "[a-zA-Z][a-zA-Z0-9]*",\n      "ConstraintDescription": "must begin with a letter and contain only alphanumeric characters."\n    },\n    "DBUsername": {\n      "Default": "admin",\n      "NoEcho": "true",\n      "Description": "The Drupal database admin account username",\n      "Type": "String",\n      "MinLength": "1",\n      "MaxLength": "16",\n      "AllowedPattern": "[a-zA-Z][a-zA-Z0-9]*",\n      "ConstraintDescription": "must begin with a letter and contain only alphanumeric characters."\n    },\n    "DBPassword": {\n      "Default": "admin",\n      "NoEcho": "true",\n      "Description": "The Drupal database admin account password",\n      "Type": "String",\n      "MinLength": "1",\n      "MaxLength": "41",\n      "AllowedPattern": "[a-zA-Z0-9]*",\n      "ConstraintDescription": "must contain only alphanumeric characters."\n    },\n    "DBRootPassword": {\n      "NoEcho": "true",\n      "Description": "Root password for MySQL",\n      "Type": "String",\n      "MinLength": "1",\n      "MaxLength": "41",\n      "AllowedPattern": "[a-zA-Z0-9]*",\n      "ConstraintDescription": "must contain only alphanumeric characters."\n    },\n    "SSHLocation": {\n      "Description": "The IP address range that can be used to SSH to the EC2 instances",\n      "Type": "String",\n      "MinLength": "9",\n      "MaxLength": "18",\n      "Default": "0.0.0.0/0",\n      "AllowedPattern": "(\\\\d{1,3})\\\\.(\\\\d{1,3})\\\\.(\\\\d{1,3})\\\\.(\\\\d{1,3})/(\\\\d{1,2})",\n      "ConstraintDescription": "must be a valid IP CIDR range of the form x.x.x.x/x."\n    }\n  },\n  "Mappings": {\n    "AWSInstanceType2Arch": {\n      "t1.micro": {\n        "Arch": "64"\n      },\n      "m1.small": {\n        "Arch": "64"\n      },\n      "m1.medium": {\n        "Arch": "64"\n      },\n      "m1.large": {\n        "Arch": "64"\n      },\n      "m1.xlarge": {\n        "Arch": "64"\n      },\n      "m2.xlarge": {\n        "Arch": "64"\n      },\n      "m2.2xlarge": {\n        "Arch": "64"\n      },\n      "m2.4xlarge": {\n        "Arch": "64"\n      },\n      "m3.xlarge": {\n        "Arch": "64"\n      },\n      "m3.2xlarge": {\n        "Arch": "64"\n      },\n      "c1.medium": {\n        "Arch": "64"\n      },\n      "c1.xlarge": {\n        "Arch": "64"\n      },\n      "cc1.4xlarge": {\n        "Arch": "64HVM"\n      },\n      "cc2.8xlarge": {\n        "Arch": "64HVM"\n      },\n      "cg1.4xlarge": {\n        "Arch": "64HVM"\n      }\n    },\n    "AWSRegionArch2AMI": {\n      "us-east-1": {\n        "32": "ami-a0cd60c9",\n        "64": "ami-aecd60c7",\n        "64HVM": "ami-a8cd60c1"\n      },\n      "us-west-2": {\n        "32": "ami-46da5576",\n        "64": "ami-48da5578",\n        "64HVM": "NOT_YET_SUPPORTED"\n      },\n      "us-west-1": {\n        "32": "ami-7d4c6938",\n        "64": "ami-734c6936",\n        "64HVM": "NOT_YET_SUPPORTED"\n      },\n      "eu-west-1": {\n        "32": "ami-61555115",\n        "64": "ami-6d555119",\n        "64HVM": "ami-67555113"\n      },\n      "ap-southeast-1": {\n        "32": "ami-220b4a70",\n        "64": "ami-3c0b4a6e",\n        "64HVM": "NOT_YET_SUPPORTED"\n      },\n      "ap-southeast-2": {\n        "32": "ami-b3990e89",\n        "64": "ami-bd990e87",\n        "64HVM": "NOT_YET_SUPPORTED"\n      },\n      "ap-northeast-1": {\n        "32": "ami-2a19aa2b",\n        "64": "ami-2819aa29",\n        "64HVM": "NOT_YET_SUPPORTED"\n      },\n      "sa-east-1": {\n        "32": "ami-f836e8e5",\n        "64": "ami-fe36e8e3",\n        "64HVM": "NOT_YET_SUPPORTED"\n      }\n    }\n  },\n  "Resources": {\n    "WebServer": {\n      "Type": "AWS::EC2::Instance",\n      "Metadata": {\n        "AWS::CloudFormation::Init": {\n          "config": {\n            "packages": {\n              "yum": {\n                "httpd": [],\n                "php": [],\n                "php-mysql": [],\n                "php-gd": [],\n                "php-xml": [],\n                "php-mbstring": [],\n                "mysql": [],\n                "mysql-server": [],\n                "mysql-devel": [],\n                "mysql-libs": []\n              }\n            },\n            "sources": {\n              "/var/www/html": "http://ftp.drupal.org/files/projects/drupal-7.8.tar.gz",\n              "/home/ec2-user": "http://ftp.drupal.org/files/projects/drush-7.x-4.5.tar.gz"\n            },\n            "files": {\n              "/tmp/setup.mysql": {\n                "content": {\n                  "Fn::Join": [\n                    "",\n                    [\n                      "CREATE DATABASE ",\n                      {\n                        "Ref": "DBName"\n                      },\n                      ";\\n",\n                      "CREATE USER '",\n                      {\n                        "Ref": "DBUsername"\n                      },\n                      "'@'localhost' IDENTIFIED BY '",\n                      {\n                        "Ref": "DBPassword"\n                      },\n                      "';\\n",\n                      "GRANT ALL ON ",\n                      {\n                        "Ref": "DBName"\n                      },\n                      ".* TO '",\n                      {\n                        "Ref": "DBUsername"\n                      },\n                      "'@'localhost';\\n",\n                      "FLUSH PRIVILEGES;\\n"\n                    ]\n                  ]\n                },\n                "mode": "000644",\n                "owner": "root",\n                "group": "root"\n              }\n            },\n            "services": {\n              "sysvinit": {\n                "httpd": {\n                  "enabled": "true",\n                  "ensureRunning": "true"\n                },\n                "mysqld": {\n                  "enabled": "true",\n                  "ensureRunning": "true"\n                },\n                "sendmail": {\n                  "enabled": "false",\n                  "ensureRunning": "false"\n                }\n              }\n            }\n          }\n        }\n      },\n      "Properties": {\n        "ImageId": {\n          "Fn::FindInMap": [\n            "AWSRegionArch2AMI",\n            {\n              "Ref": "AWS::Region"\n            },\n            {\n              "Fn::FindInMap": [\n                "AWSInstanceType2Arch",\n                {\n                  "Ref": "InstanceType"\n                },\n                "Arch"\n              ]\n            }\n          ]\n        },\n        "InstanceType": {\n          "Ref": "InstanceType"\n        },\n        "SecurityGroups": [\n          {\n            "Ref": "WebServerSecurityGroup"\n          }\n        ],\n        "KeyName": {\n          "Ref": "KeyName"\n        },\n        "UserData": {\n          "Fn::Base64": {\n            "Fn::Join": [\n              "",\n              [\n                "#!/bin/bash -v\\n",\n                "yum update -y aws-cfn-bootstrap\\n",\n                "# Helper function\\n",\n                "function error_exit\\n",\n                "{\\n",\n                "  /opt/aws/bin/cfn-signal -e 0 -r \\"$1\\" '",\n                {\n                  "Ref": "WaitHandle"\n                },\n                "'\\n",\n                "  exit 1\\n",\n                "}\\n",\n                "# Install Apache Web Server, MySQL, PHP and Drupal\\n",\n                "/opt/aws/bin/cfn-init -s ",\n                {\n                  "Ref": "AWS::StackId"\n                },\n                " -r WebServer ",\n                "    --region ",\n                {\n                  "Ref": "AWS::Region"\n                },\n                " || error_exit 'Failed to run cfn-init'\\n",\n                "# Setup MySQL root password and create a user\\n",\n                "mysqladmin -u root password '",\n                {\n                  "Ref": "DBRootPassword"\n                },\n                "' || error_exit 'Failed to initialize root password'\\n",\n                "mysql -u root --password='",\n                {\n                  "Ref": "DBRootPassword"\n                },\n                "' \\u003C /tmp/setup.mysql || error_exit 'Failed to create database user'\\n",\n                "# Make changes to Apache Web Server configuration\\n",\n                "mv /var/www/html/drupal-7.8/* /var/www/html\\n",\n                "mv /var/www/html/drupal-7.8/.* /var/www/html\\n",\n                "rmdir /var/www/html/drupal-7.8\\n",\n                "sed -i 's/AllowOverride None/AllowOverride All/g'  /etc/httpd/conf/httpd.conf\\n",\n                "service httpd restart\\n",\n                "# Create the site in Drupal\\n",\n                "cd /var/www/html\\n",\n                "~ec2-user/drush/drush site-install standard --yes",\n                "     --site-name='",\n                {\n                  "Ref": "SiteName"\n                },\n                "' --site-mail=",\n                {\n                  "Ref": "SiteEMail"\n                },\n                "     --account-name=",\n                {\n                  "Ref": "SiteAdmin"\n                },\n                " --account-pass=",\n                {\n                  "Ref": "SitePassword"\n                },\n                "     --db-url=mysql://",\n                {\n                  "Ref": "DBUsername"\n                },\n                ":",\n                {\n                  "Ref": "DBPassword"\n                },\n                "@localhost/",\n                {\n                  "Ref": "DBName"\n                },\n                "     --db-prefix=drupal_\\n",\n                "chown apache:apache sites/default/files\\n",\n                "# All is well so signal success\\n",\n                "/opt/aws/bin/cfn-signal -e 0 -r \\"Drupal setup complete\\" '",\n                {\n                  "Ref": "WaitHandle"\n                },\n                "'\\n"\n              ]\n            ]\n          }\n        }\n      }\n    },\n    "WaitHandle": {\n      "Type": "AWS::CloudFormation::WaitConditionHandle"\n    },\n    "WaitCondition": {\n      "Type": "AWS::CloudFormation::WaitCondition",\n      "DependsOn": "WebServer",\n      "Properties": {\n        "Handle": {\n          "Ref": "WaitHandle"\n        },\n        "Timeout": "300"\n      }\n    },\n    "WebServerSecurityGroup": {\n      "Type": "AWS::EC2::SecurityGroup",\n      "Properties": {\n        "GroupDescription": "Enable HTTP access via port 80 and SSH access",\n        "SecurityGroupIngress": [\n          {\n            "IpProtocol": "tcp",\n            "FromPort": "80",\n            "ToPort": "80",\n            "CidrIp": "0.0.0.0/0"\n          },\n          {\n            "IpProtocol": "tcp",\n            "FromPort": "22",\n            "ToPort": "22",\n            "CidrIp": {\n              "Ref": "SSHLocation"\n            }\n          }\n        ]\n      }\n    }\n  },\n  "Outputs": {\n    "WebsiteURL": {\n      "Value": {\n        "Fn::Join": [\n          "",\n          [\n            "http://",\n            {\n              "Fn::GetAtt": [\n                "WebServer",\n                "PublicDnsName"\n              ]\n            }\n          ]\n        ]\n      },\n      "Description": "Drupal Website"\n    }\n  }\n}\n	{"main.tf": "# Converted from CloudFormation template Drupal_Single_Instance\\n# Machine-generated Terraform configuration\\n\\ndata \\"aws_region\\" \\"current\\" {\\n\\n}\\n\\nresource \\"aws_security_group\\" \\"web_server_security_group\\" {\\n  name_prefix = \\"drupal-web-server-\\"\\n  description = \\"Enable HTTP access via port 80 and SSH access\\"\\n\\n  ingress {\\n    protocol    = \\"tcp\\"\\n    from_port   = 80\\n    to_port     = 80\\n    cidr_blocks = [\\"0.0.0.0/0\\"]\\n  }\\n\\n  ingress {\\n    protocol    = \\"tcp\\"\\n    from_port   = 22\\n    to_port     = 22\\n    cidr_blocks = [var.ssh_location]\\n  }\\n\\n  egress {\\n    protocol    = \\"-1\\"\\n    from_port   = 0\\n    to_port     = 0\\n    cidr_blocks = [\\"0.0.0.0/0\\"]\\n  }\\n}\\n\\nresource \\"aws_instance\\" \\"web_server\\" {\\n  ami                    = local.aws_region_arch_2_ami[data.aws_region.current.name][local.aws_instance_type_2_arch[var.instance_type][\\"Arch\\"]]\\n  instance_type          = var.instance_type\\n  key_name               = var.key_name\\n  vpc_security_group_ids = [aws_security_group.web_server_security_group.id]\\n\\n  # Note: CloudFormation::Init metadata and WaitCondition resources don't have direct Terraform equivalents.\\n  # The original template used cfn-init and cfn-signal for orchestration. In Terraform, consider using:\\n  # - cloud-init user data (as done below)\\n  # - Ansible/Chef/Puppet for configuration management\\n  # - null_resource with remote-exec provisioner for complex setups\\n\\n  user_data = base64encode(<<-EOF\\n#!/bin/bash -v\\nyum update -y aws-cfn-bootstrap\\n\\n# Helper function - simplified since we don't have WaitCondition\\nfunction error_exit\\n{\\n  echo \\"ERROR: $1\\" >&2\\n  exit 1\\n}\\n\\n# Install packages that were in CloudFormation::Init\\nyum install -y httpd php php-mysql php-gd php-xml php-mbstring mysql mysql-server mysql-devel mysql-libs || error_exit 'Failed to install packages'\\n\\n# Download and extract Drupal\\ncd /var/www/html\\nwget http://ftp.drupal.org/files/projects/drupal-7.8.tar.gz || error_exit 'Failed to download Drupal'\\ntar -xzf drupal-7.8.tar.gz || error_exit 'Failed to extract Drupal'\\nmv drupal-7.8/* .\\nmv drupal-7.8/.* . 2>/dev/null || true\\nrmdir drupal-7.8\\nrm drupal-7.8.tar.gz\\n\\n# Download Drush\\ncd /home/ec2-user\\nwget http://ftp.drupal.org/files/projects/drush-7.x-4.5.tar.gz || error_exit 'Failed to download Drush'\\ntar -xzf drush-7.x-4.5.tar.gz || error_exit 'Failed to extract Drush'\\nrm drush-7.x-4.5.tar.gz\\nchown -R ec2-user:ec2-user drush\\n\\n# Create MySQL setup file\\ncat > /tmp/setup.mysql << 'MYSQLEOF'\\n${local.mysql_setup_content}\\nMYSQLEOF\\n\\n# Start services\\nservice httpd start || error_exit 'Failed to start httpd'\\nchkconfig httpd on\\nservice mysqld start || error_exit 'Failed to start mysqld'\\nchkconfig mysqld on\\n\\n# Setup MySQL root password and create database user\\nmysqladmin -u root password '${var.db_root_password}' || error_exit 'Failed to initialize root password'\\nmysql -u root --password='${var.db_root_password}' < /tmp/setup.mysql || error_exit 'Failed to create database user'\\n\\n# Make changes to Apache Web Server configuration\\nsed -i 's/AllowOverride None/AllowOverride All/g' /etc/httpd/conf/httpd.conf\\nservice httpd restart\\n\\n# Create the site in Drupal\\ncd /var/www/html\\n/home/ec2-user/drush/drush site-install standard --yes \\\\\\n  --site-name='${var.site_name}' \\\\\\n  --site-mail=${var.site_email} \\\\\\n  --account-name=${var.site_admin} \\\\\\n  --account-pass=${var.site_password} \\\\\\n  --db-url=mysql://${var.db_username}:${var.db_password}@localhost/${var.db_name} \\\\\\n  --db-prefix=drupal_ || error_exit 'Failed to install Drupal site'\\n\\nchown -R apache:apache sites/default/files\\n\\necho \\"Drupal setup complete\\"\\nEOF\\n  )\\n\\n  tags = {\\n    Name = \\"Drupal Web Server\\"\\n  }\\n}", "locals.tf": "locals {\\n  aws_instance_type_2_arch = {\\n    \\"t1.micro\\"    = { \\"Arch\\" = \\"64\\" }\\n    \\"m1.small\\"    = { \\"Arch\\" = \\"64\\" }\\n    \\"m1.medium\\"   = { \\"Arch\\" = \\"64\\" }\\n    \\"m1.large\\"    = { \\"Arch\\" = \\"64\\" }\\n    \\"m1.xlarge\\"   = { \\"Arch\\" = \\"64\\" }\\n    \\"m2.xlarge\\"   = { \\"Arch\\" = \\"64\\" }\\n    \\"m2.2xlarge\\"  = { \\"Arch\\" = \\"64\\" }\\n    \\"m2.4xlarge\\"  = { \\"Arch\\" = \\"64\\" }\\n    \\"m3.xlarge\\"   = { \\"Arch\\" = \\"64\\" }\\n    \\"m3.2xlarge\\"  = { \\"Arch\\" = \\"64\\" }\\n    \\"c1.medium\\"   = { \\"Arch\\" = \\"64\\" }\\n    \\"c1.xlarge\\"   = { \\"Arch\\" = \\"64\\" }\\n    \\"cc1.4xlarge\\" = { \\"Arch\\" = \\"64HVM\\" }\\n    \\"cc2.8xlarge\\" = { \\"Arch\\" = \\"64HVM\\" }\\n    \\"cg1.4xlarge\\" = { \\"Arch\\" = \\"64HVM\\" }\\n  }\\n\\n  aws_region_arch_2_ami = {\\n    \\"us-east-1\\" = {\\n      \\"32\\"    = \\"ami-a0cd60c9\\"\\n      \\"64\\"    = \\"ami-aecd60c7\\"\\n      \\"64HVM\\" = \\"ami-a8cd60c1\\"\\n    }\\n    \\"us-west-2\\" = {\\n      \\"32\\"    = \\"ami-46da5576\\"\\n      \\"64\\"    = \\"ami-48da5578\\"\\n      \\"64HVM\\" = \\"NOT_YET_SUPPORTED\\"\\n    }\\n    \\"us-west-1\\" = {\\n      \\"32\\"    = \\"ami-7d4c6938\\"\\n      \\"64\\"    = \\"ami-734c6936\\"\\n      \\"64HVM\\" = \\"NOT_YET_SUPPORTED\\"\\n    }\\n    \\"eu-west-1\\" = {\\n      \\"32\\"    = \\"ami-61555115\\"\\n      \\"64\\"    = \\"ami-6d555119\\"\\n      \\"64HVM\\" = \\"ami-67555113\\"\\n    }\\n    \\"ap-southeast-1\\" = {\\n      \\"32\\"    = \\"ami-220b4a70\\"\\n      \\"64\\"    = \\"ami-3c0b4a6e\\"\\n      \\"64HVM\\" = \\"NOT_YET_SUPPORTED\\"\\n    }\\n    \\"ap-southeast-2\\" = {\\n      \\"32\\"    = \\"ami-b3990e89\\"\\n      \\"64\\"    = \\"ami-bd990e87\\"\\n      \\"64HVM\\" = \\"NOT_YET_SUPPORTED\\"\\n    }\\n    \\"ap-northeast-1\\" = {\\n      \\"32\\"    = \\"ami-2a19aa2b\\"\\n      \\"64\\"    = \\"ami-2819aa29\\"\\n      \\"64HVM\\" = \\"NOT_YET_SUPPORTED\\"\\n    }\\n    \\"sa-east-1\\" = {\\n      \\"32\\"    = \\"ami-f836e8e5\\"\\n      \\"64\\"    = \\"ami-fe36e8e3\\"\\n      \\"64HVM\\" = \\"NOT_YET_SUPPORTED\\"\\n    }\\n  }\\n\\n  mysql_setup_content = <<-EOF\\nCREATE DATABASE ${var.db_name};\\nCREATE USER '${var.db_username}'@'localhost' IDENTIFIED BY '${var.db_password}';\\nGRANT ALL ON ${var.db_name}.* TO '${var.db_username}'@'localhost';\\nFLUSH PRIVILEGES;\\nEOF\\n}", "outputs.tf": "output \\"website_url\\" {\\n  value       = \\"http://${aws_instance.web_server.public_dns}\\"\\n  description = \\"Drupal Website\\"\\n}", "providers.tf": "terraform {\\n  required_version = \\">= 1.5.0\\"\\n  required_providers {\\n    aws = {\\n      source  = \\"hashicorp/aws\\"\\n      version = \\"~> 5.0\\"\\n    }\\n    random = {\\n      source  = \\"hashicorp/random\\"\\n      version = \\"~> 3.0\\"\\n    }\\n  }\\n\\n  # Uncomment for remote state\\n  # backend \\"s3\\" {\\n  #   bucket = \\"my-tfstate\\"\\n  #   key    = \\"prod/terraform.tfstate\\"\\n  #   region = \\"us-east-1\\"\\n  # }\\n}\\n\\nprovider \\"aws\\" {\\n  region = var.aws_region\\n}", "variables.tf": "variable \\"aws_region\\" {\\n  type        = string\\n  default     = \\"us-east-1\\"\\n  description = \\"AWS region for resources\\"\\n}\\n\\nvariable \\"key_name\\" {\\n  type        = string\\n  description = \\"Name of an existing EC2 KeyPair to enable SSH access to the instances\\"\\n  validation {\\n    condition     = can(regex(\\"^[\\\\\\\\x20-\\\\\\\\x7E]+$\\", var.key_name)) && length(var.key_name) >= 1 && length(var.key_name) <= 255\\n    error_message = \\"KeyName can contain only ASCII characters and must be between 1-255 characters.\\"\\n  }\\n}\\n\\nvariable \\"instance_type\\" {\\n  type        = string\\n  default     = \\"m1.small\\"\\n  description = \\"WebServer EC2 instance type\\"\\n  validation {\\n    condition = contains([\\n      \\"t1.micro\\", \\"m1.small\\", \\"m1.medium\\", \\"m1.large\\", \\"m1.xlarge\\",\\n      \\"m2.xlarge\\", \\"m2.2xlarge\\", \\"m2.4xlarge\\", \\"m3.xlarge\\", \\"m3.2xlarge\\",\\n      \\"c1.medium\\", \\"c1.xlarge\\", \\"cc1.4xlarge\\", \\"cc2.8xlarge\\", \\"cg1.4xlarge\\"\\n    ], var.instance_type)\\n    error_message = \\"Must be a valid EC2 instance type.\\"\\n  }\\n}\\n\\nvariable \\"site_name\\" {\\n  type        = string\\n  default     = \\"My Site\\"\\n  description = \\"The name of the Drupal Site\\"\\n}\\n\\nvariable \\"site_email\\" {\\n  type        = string\\n  description = \\"EMail for site adminitrator\\"\\n}\\n\\nvariable \\"site_admin\\" {\\n  type        = string\\n  description = \\"The Drupal site admin account username\\"\\n  validation {\\n    condition     = can(regex(\\"^[a-zA-Z][a-zA-Z0-9]*$\\", var.site_admin)) && length(var.site_admin) >= 1 && length(var.site_admin) <= 16\\n    error_message = \\"Must begin with a letter and contain only alphanumeric characters (1-16 chars).\\"\\n  }\\n}\\n\\nvariable \\"site_password\\" {\\n  type        = string\\n  sensitive   = true\\n  description = \\"The Drupal site admin account password\\"\\n  validation {\\n    condition     = can(regex(\\"^[a-zA-Z0-9]+$\\", var.site_password)) && length(var.site_password) >= 1 && length(var.site_password) <= 41\\n    error_message = \\"Must contain only alphanumeric characters (1-41 chars).\\"\\n  }\\n}\\n\\nvariable \\"db_name\\" {\\n  type        = string\\n  default     = \\"drupaldb\\"\\n  description = \\"The Drupal database name\\"\\n  validation {\\n    condition     = can(regex(\\"^[a-zA-Z][a-zA-Z0-9]*$\\", var.db_name)) && length(var.db_name) >= 1 && length(var.db_name) <= 64\\n    error_message = \\"Must begin with a letter and contain only alphanumeric characters (1-64 chars).\\"\\n  }\\n}\\n\\nvariable \\"db_username\\" {\\n  type        = string\\n  default     = \\"admin\\"\\n  sensitive   = true\\n  description = \\"The Drupal database admin account username\\"\\n  validation {\\n    condition     = can(regex(\\"^[a-zA-Z][a-zA-Z0-9]*$\\", var.db_username)) && length(var.db_username) >= 1 && length(var.db_username) <= 16\\n    error_message = \\"Must begin with a letter and contain only alphanumeric characters (1-16 chars).\\"\\n  }\\n}\\n\\nvariable \\"db_password\\" {\\n  type        = string\\n  default     = \\"admin\\"\\n  sensitive   = true\\n  description = \\"The Drupal database admin account password\\"\\n  validation {\\n    condition     = can(regex(\\"^[a-zA-Z0-9]+$\\", var.db_password)) && length(var.db_password) >= 1 && length(var.db_password) <= 41\\n    error_message = \\"Must contain only alphanumeric characters (1-41 chars).\\"\\n  }\\n}\\n\\nvariable \\"db_root_password\\" {\\n  type        = string\\n  sensitive   = true\\n  description = \\"Root password for MySQL\\"\\n  validation {\\n    condition     = can(regex(\\"^[a-zA-Z0-9]+$\\", var.db_root_password)) && length(var.db_root_password) >= 1 && length(var.db_root_password) <= 41\\n    error_message = \\"Must contain only alphanumeric characters (1-41 chars).\\"\\n  }\\n}\\n\\nvariable \\"ssh_location\\" {\\n  type        = string\\n  default     = \\"0.0.0.0/0\\"\\n  description = \\"The IP address range that can be used to SSH to the EC2 instances\\"\\n  validation {\\n    condition     = can(regex(\\"^(\\\\\\\\d{1,3})\\\\\\\\.(\\\\\\\\d{1,3})\\\\\\\\.(\\\\\\\\d{1,3})\\\\\\\\.(\\\\\\\\d{1,3})/(\\\\\\\\d{1,2})$\\", var.ssh_location)) && length(var.ssh_location) >= 9 && length(var.ssh_location) <= 18\\n    error_message = \\"Must be a valid IP CIDR range of the form x.x.x.x/x.\\"\\n  }\\n}"}	t	claude-sonnet-4-20250514	123191	18940	0.6880242000000001	completed	2026-04-21 10:08:16.48
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

\unrestrict rce3qbchuKAn9UXDgN6kSUq4Ss2e1W65cN86lm0bHQbdlcjvVTaLz6aaYkuyX4N

