CREATE TABLE assistant_messages (
    id text NOT NULL,
    user_id integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE code_redemptions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    code_id integer NOT NULL,
    redeemed_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE code_redemptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE code_redemptions_id_seq OWNED BY code_redemptions.id;

CREATE TABLE consent_sessions (
    id integer NOT NULL,
    invite_token text NOT NULL,
    timeline jsonb DEFAULT '[]'::jsonb NOT NULL,
    screen_frames jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai_analysis text,
    ai_summary text,
    device_snapshot jsonb,
    notifications jsonb,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    granted_at timestamp without time zone,
    time_to_grant_ms integer,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE consent_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE consent_sessions_id_seq OWNED BY consent_sessions.id;

CREATE TABLE consents (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type text NOT NULL,
    status text NOT NULL,
    purpose text,
    granted_at timestamp without time zone,
    revoked_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE consents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE consents_id_seq OWNED BY consents.id;

CREATE TABLE correlated_signals (
    id integer NOT NULL,
    token text NOT NULL,
    source_type text NOT NULL,
    latitude double precision,
    longitude double precision,
    accuracy double precision,
    confidence double precision NOT NULL,
    label text,
    metadata jsonb,
    observed_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE correlated_signals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE correlated_signals_id_seq OWNED BY correlated_signals.id;

CREATE TABLE geo_photos (
    id integer NOT NULL,
    invite_token text NOT NULL,
    photo_data text NOT NULL,
    latitude double precision,
    longitude double precision,
    address text,
    camera_facing text DEFAULT 'environment'::text NOT NULL,
    taken_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE geo_photos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE geo_photos_id_seq OWNED BY geo_photos.id;

CREATE TABLE geo_videos (
    id integer NOT NULL,
    invite_token text NOT NULL,
    video_data text NOT NULL,
    mime_type text DEFAULT 'video/webm'::text NOT NULL,
    duration_ms integer,
    latitude double precision,
    longitude double precision,
    address text,
    camera_facing text DEFAULT 'environment'::text NOT NULL,
    taken_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE geo_videos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE geo_videos_id_seq OWNED BY geo_videos.id;

CREATE TABLE geofences (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    radius_meters double precision DEFAULT 200 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE geofences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE geofences_id_seq OWNED BY geofences.id;

CREATE TABLE group_share_members (
    id integer NOT NULL,
    group_share_id integer NOT NULL,
    member_token text NOT NULL,
    invite_token text,
    display_name text,
    joined_at timestamp without time zone DEFAULT now() NOT NULL,
    last_lat double precision,
    last_lng double precision,
    last_address text,
    last_seen timestamp without time zone
);

CREATE SEQUENCE group_share_members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE group_share_members_id_seq OWNED BY group_share_members.id;

CREATE TABLE group_shares (
    id integer NOT NULL,
    group_id text NOT NULL,
    owner_user_id integer NOT NULL,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE group_shares_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE group_shares_id_seq OWNED BY group_shares.id;

CREATE TABLE invite_sessions (
    id integer NOT NULL,
    invite_token text NOT NULL,
    session_token text NOT NULL,
    granted_at timestamp without time zone,
    granted_latitude double precision,
    granted_longitude double precision,
    granted_address text,
    granted_ip text,
    expires_at timestamp without time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE invite_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE invite_sessions_id_seq OWNED BY invite_sessions.id;

CREATE TABLE invites (
    id integer NOT NULL,
    from_user_id integer NOT NULL,
    to_phone text NOT NULL,
    to_name text,
    message text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    whatsapp_link text NOT NULL,
    consent_type text,
    token text NOT NULL,
    consent_page_url text,
    granted_latitude double precision,
    granted_longitude double precision,
    granted_address text,
    granted_at timestamp without time zone,
    sent_at timestamp without time zone DEFAULT now() NOT NULL,
    opened_ip text,
    opened_at timestamp without time zone,
    opened_user_agent text,
    ip_info jsonb,
    granted_ip text
);

CREATE SEQUENCE invites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE invites_id_seq OWNED BY invites.id;

CREATE TABLE lan_ips (
    id integer NOT NULL,
    user_id integer NOT NULL,
    ip text NOT NULL,
    label text NOT NULL,
    address text,
    latitude real,
    longitude real,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE lan_ips_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE lan_ips_id_seq OWNED BY lan_ips.id;

CREATE TABLE location_type_overrides (
    id integer NOT NULL,
    invite_token text NOT NULL,
    lat_key double precision NOT NULL,
    lng_key double precision NOT NULL,
    override_type text NOT NULL,
    source_report_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE location_type_overrides_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE location_type_overrides_id_seq OWNED BY location_type_overrides.id;

CREATE TABLE location_type_reports (
    id integer NOT NULL,
    invite_token text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    reported_type text NOT NULL,
    suggested_type text NOT NULL,
    comment text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE location_type_reports_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE location_type_reports_id_seq OWNED BY location_type_reports.id;

CREATE TABLE location_updates (
    id integer NOT NULL,
    token text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    accuracy double precision,
    source text,
    address text,
    status text DEFAULT 'active'::text NOT NULL,
    battery_level integer,
    battery_charging boolean,
    activity_type text,
    device_info jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    spoof_score integer,
    spoof_flags jsonb
);

CREATE SEQUENCE location_updates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE location_updates_id_seq OWNED BY location_updates.id;

CREATE TABLE manual_pins (
    id integer NOT NULL,
    user_id integer NOT NULL,
    name text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE manual_pins_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE manual_pins_id_seq OWNED BY manual_pins.id;

CREATE TABLE notifications_log (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    data jsonb,
    read boolean DEFAULT false NOT NULL,
    pinned boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE notifications_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE notifications_log_id_seq OWNED BY notifications_log.id;

CREATE TABLE push_subscriptions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    endpoint text NOT NULL,
    keys_auth text NOT NULL,
    keys_p256dh text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE push_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE push_subscriptions_id_seq OWNED BY push_subscriptions.id;

CREATE TABLE street_view_photos (
    id integer NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    mapillary_image_id text NOT NULL,
    image_url text,
    embed_url text NOT NULL,
    saved_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE street_view_photos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE street_view_photos_id_seq OWNED BY street_view_photos.id;

CREATE TABLE subscription_codes (
    id integer NOT NULL,
    code text NOT NULL,
    label text,
    duration_days integer,
    max_redemptions integer,
    price_naira integer,
    redemption_count integer DEFAULT 0 NOT NULL,
    is_revoked boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE subscription_codes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE subscription_codes_id_seq OWNED BY subscription_codes.id;

CREATE TABLE user_access (
    user_id integer NOT NULL,
    free_accesses_used integer DEFAULT 0 NOT NULL,
    free_access_limit integer DEFAULT 3 NOT NULL,
    active_code_id integer,
    access_expires_at timestamp without time zone,
    has_unlimited_access boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE TABLE users (
    id integer NOT NULL,
    name text NOT NULL,
    phone_number text,
    country_code text,
    country_iso text,
    full_phone text,
    google_id text,
    google_email text,
    google_name text,
    google_picture text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);

CREATE SEQUENCE users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE users_id_seq OWNED BY users.id;

ALTER TABLE ONLY code_redemptions ALTER COLUMN id SET DEFAULT nextval('code_redemptions_id_seq'::regclass);

ALTER TABLE ONLY consent_sessions ALTER COLUMN id SET DEFAULT nextval('consent_sessions_id_seq'::regclass);

ALTER TABLE ONLY consents ALTER COLUMN id SET DEFAULT nextval('consents_id_seq'::regclass);

ALTER TABLE ONLY correlated_signals ALTER COLUMN id SET DEFAULT nextval('correlated_signals_id_seq'::regclass);

ALTER TABLE ONLY geo_photos ALTER COLUMN id SET DEFAULT nextval('geo_photos_id_seq'::regclass);

ALTER TABLE ONLY geo_videos ALTER COLUMN id SET DEFAULT nextval('geo_videos_id_seq'::regclass);

ALTER TABLE ONLY geofences ALTER COLUMN id SET DEFAULT nextval('geofences_id_seq'::regclass);

ALTER TABLE ONLY group_share_members ALTER COLUMN id SET DEFAULT nextval('group_share_members_id_seq'::regclass);

ALTER TABLE ONLY group_shares ALTER COLUMN id SET DEFAULT nextval('group_shares_id_seq'::regclass);

ALTER TABLE ONLY invite_sessions ALTER COLUMN id SET DEFAULT nextval('invite_sessions_id_seq'::regclass);

ALTER TABLE ONLY invites ALTER COLUMN id SET DEFAULT nextval('invites_id_seq'::regclass);

ALTER TABLE ONLY lan_ips ALTER COLUMN id SET DEFAULT nextval('lan_ips_id_seq'::regclass);

ALTER TABLE ONLY location_type_overrides ALTER COLUMN id SET DEFAULT nextval('location_type_overrides_id_seq'::regclass);

ALTER TABLE ONLY location_type_reports ALTER COLUMN id SET DEFAULT nextval('location_type_reports_id_seq'::regclass);

ALTER TABLE ONLY location_updates ALTER COLUMN id SET DEFAULT nextval('location_updates_id_seq'::regclass);

ALTER TABLE ONLY manual_pins ALTER COLUMN id SET DEFAULT nextval('manual_pins_id_seq'::regclass);

ALTER TABLE ONLY notifications_log ALTER COLUMN id SET DEFAULT nextval('notifications_log_id_seq'::regclass);

ALTER TABLE ONLY push_subscriptions ALTER COLUMN id SET DEFAULT nextval('push_subscriptions_id_seq'::regclass);

ALTER TABLE ONLY street_view_photos ALTER COLUMN id SET DEFAULT nextval('street_view_photos_id_seq'::regclass);

ALTER TABLE ONLY subscription_codes ALTER COLUMN id SET DEFAULT nextval('subscription_codes_id_seq'::regclass);

ALTER TABLE ONLY users ALTER COLUMN id SET DEFAULT nextval('users_id_seq'::regclass);

ALTER TABLE ONLY assistant_messages
    ADD CONSTRAINT assistant_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY code_redemptions
    ADD CONSTRAINT code_redemptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY consent_sessions
    ADD CONSTRAINT consent_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY consents
    ADD CONSTRAINT consents_pkey PRIMARY KEY (id);

ALTER TABLE ONLY correlated_signals
    ADD CONSTRAINT correlated_signals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY geo_photos
    ADD CONSTRAINT geo_photos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY geo_videos
    ADD CONSTRAINT geo_videos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY geofences
    ADD CONSTRAINT geofences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY group_share_members
    ADD CONSTRAINT group_share_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY group_shares
    ADD CONSTRAINT group_shares_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invite_sessions
    ADD CONSTRAINT invite_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invite_sessions
    ADD CONSTRAINT invite_sessions_session_token_unique UNIQUE (session_token);

ALTER TABLE ONLY invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY invites
    ADD CONSTRAINT invites_token_unique UNIQUE (token);

ALTER TABLE ONLY lan_ips
    ADD CONSTRAINT lan_ips_pkey PRIMARY KEY (id);

ALTER TABLE ONLY location_type_overrides
    ADD CONSTRAINT location_type_overrides_pkey PRIMARY KEY (id);

ALTER TABLE ONLY location_type_reports
    ADD CONSTRAINT location_type_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY location_updates
    ADD CONSTRAINT location_updates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY manual_pins
    ADD CONSTRAINT manual_pins_pkey PRIMARY KEY (id);

ALTER TABLE ONLY notifications_log
    ADD CONSTRAINT notifications_log_pkey PRIMARY KEY (id);

ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint);

ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY street_view_photos
    ADD CONSTRAINT street_view_photos_pkey PRIMARY KEY (id);

ALTER TABLE ONLY subscription_codes
    ADD CONSTRAINT subscription_codes_code_unique UNIQUE (code);

ALTER TABLE ONLY subscription_codes
    ADD CONSTRAINT subscription_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY user_access
    ADD CONSTRAINT user_access_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_full_phone_unique UNIQUE (full_phone);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_google_id_unique UNIQUE (google_id);

ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX cs_observed_at_idx ON correlated_signals USING btree (observed_at);

CREATE INDEX cs_source_type_idx ON correlated_signals USING btree (source_type);

CREATE INDEX cs_token_idx ON correlated_signals USING btree (token);

CREATE UNIQUE INDEX group_shares_group_id_idx ON group_shares USING btree (group_id);

CREATE UNIQUE INDEX street_view_photos_image_id_idx ON street_view_photos USING btree (mapillary_image_id);

CREATE INDEX street_view_photos_lat_lng_idx ON street_view_photos USING btree (latitude, longitude);

ALTER TABLE ONLY code_redemptions
    ADD CONSTRAINT code_redemptions_code_id_subscription_codes_id_fk FOREIGN KEY (code_id) REFERENCES subscription_codes(id) ON DELETE CASCADE;

ALTER TABLE ONLY code_redemptions
    ADD CONSTRAINT code_redemptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY consents
    ADD CONSTRAINT consents_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY geofences
    ADD CONSTRAINT geofences_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY group_share_members
    ADD CONSTRAINT group_share_members_group_share_id_group_shares_id_fk FOREIGN KEY (group_share_id) REFERENCES group_shares(id) ON DELETE CASCADE;

ALTER TABLE ONLY group_shares
    ADD CONSTRAINT group_shares_owner_user_id_users_id_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY invite_sessions
    ADD CONSTRAINT invite_sessions_invite_token_invites_token_fk FOREIGN KEY (invite_token) REFERENCES invites(token) ON DELETE CASCADE;

ALTER TABLE ONLY invites
    ADD CONSTRAINT invites_from_user_id_users_id_fk FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY manual_pins
    ADD CONSTRAINT manual_pins_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY notifications_log
    ADD CONSTRAINT notifications_log_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE ONLY user_access
    ADD CONSTRAINT user_access_active_code_id_subscription_codes_id_fk FOREIGN KEY (active_code_id) REFERENCES subscription_codes(id) ON DELETE SET NULL;

ALTER TABLE ONLY user_access
    ADD CONSTRAINT user_access_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
