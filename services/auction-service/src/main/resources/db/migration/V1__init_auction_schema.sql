-- ============================================================
-- StaySphere AOS — Auction Service Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS auction_lots (
    id                          VARCHAR(36) PRIMARY KEY,
    property_id                 VARCHAR(36)     NOT NULL,
    seller_id                   VARCHAR(36)     NOT NULL,
    title                       VARCHAR(300)    NOT NULL,
    description                 TEXT,
    auction_type                VARCHAR(20)     NOT NULL,
    status                      VARCHAR(20)     NOT NULL DEFAULT 'DRAFT',
    starts_at                   TIMESTAMP       NOT NULL,
    scheduled_ends_at           TIMESTAMP       NOT NULL,
    actual_ends_at              TIMESTAMP,

    -- Pricing
    starting_price              DECIMAL(14,2)   NOT NULL,
    reserve_price               DECIMAL(14,2),
    buy_it_now_price            DECIMAL(14,2),
    minimum_bid_increment       DECIMAL(14,2)   NOT NULL DEFAULT 100.00,
    currency                    VARCHAR(10)     NOT NULL DEFAULT 'NAD',

    -- Dutch auction
    dutch_start_price           DECIMAL(14,2),
    dutch_floor_price           DECIMAL(14,2),
    dutch_decrement_amount      DECIMAL(14,2),
    dutch_decrement_interval_seconds INTEGER,

    -- Anti-snipe
    anti_snipe_enabled          BOOLEAN         NOT NULL DEFAULT TRUE,
    anti_snipe_trigger_seconds  INTEGER         NOT NULL DEFAULT 300,
    anti_snipe_extension_seconds INTEGER        NOT NULL DEFAULT 300,
    max_anti_snipe_extensions   INTEGER         NOT NULL DEFAULT 10,
    anti_snipe_extension_count  INTEGER         NOT NULL DEFAULT 0,

    -- Deposit / KYC
    deposit_required            BOOLEAN         NOT NULL DEFAULT FALSE,
    deposit_amount              DECIMAL(14,2),
    kyc_required                BOOLEAN         NOT NULL DEFAULT FALSE,
    kyc_threshold_amount        DECIMAL(14,2),

    -- Live state (denormalized)
    current_bid_amount          DECIMAL(14,2),
    current_lead_bidder_id      VARCHAR(36),
    current_lead_bid_id         VARCHAR(36),
    total_bids                  INTEGER         NOT NULL DEFAULT 0,
    unique_bidders              INTEGER         NOT NULL DEFAULT 0,

    -- Winner
    winner_id                   VARCHAR(36),
    winning_bid_id              VARCHAR(36),
    winning_amount              DECIMAL(14,2),

    -- Livestream
    livestream_provider         VARCHAR(50),
    livestream_key              VARCHAR(255),
    livestream_playback_id      VARCHAR(255),
    livestream_url              VARCHAR(500),
    livestream_active           BOOLEAN         DEFAULT FALSE,

    -- Content
    image_urls                  TEXT,
    document_urls               TEXT,
    terms_and_conditions        TEXT,
    property_address            VARCHAR(500),
    property_city               VARCHAR(100),

    created_at                  TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lot_status    ON auction_lots(status);
CREATE INDEX idx_lot_type      ON auction_lots(auction_type);
CREATE INDEX idx_lot_starts_at ON auction_lots(starts_at);
CREATE INDEX idx_lot_property  ON auction_lots(property_id);
CREATE INDEX idx_lot_seller    ON auction_lots(seller_id);

-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bids (
    id                      VARCHAR(36) PRIMARY KEY,
    auction_lot_id          VARCHAR(36)     NOT NULL REFERENCES auction_lots(id),
    bidder_id               VARCHAR(36)     NOT NULL,
    bidder_email            VARCHAR(255)    NOT NULL,
    amount                  DECIMAL(14,2)   NOT NULL,
    proxy_ceiling           DECIMAL(14,2),
    sealed_bid_hash         TEXT,
    is_sealed               BOOLEAN         DEFAULT FALSE,
    status                  VARCHAR(20)     NOT NULL DEFAULT 'ACTIVE',
    ip_address              VARCHAR(64),
    device_fingerprint      VARCHAR(255),
    user_agent              TEXT,
    fraud_score             DECIMAL(5,4)    NOT NULL DEFAULT 0.0000,
    flagged_for_review      BOOLEAN         DEFAULT FALSE,
    triggered_anti_snipe    BOOLEAN         NOT NULL DEFAULT FALSE,
    currency                VARCHAR(10)     NOT NULL DEFAULT 'NAD',
    ms_remaining_at_bid     BIGINT,
    placed_at               TIMESTAMP       NOT NULL DEFAULT NOW(),
    outbid_at               TIMESTAMP,
    bid_sequence            BIGINT
);

CREATE INDEX idx_bid_lot    ON bids(auction_lot_id);
CREATE INDEX idx_bid_bidder ON bids(bidder_id);
CREATE INDEX idx_bid_status ON bids(status);
CREATE INDEX idx_bid_amount ON bids(amount DESC);

-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bidder_deposits (
    id                          VARCHAR(36) PRIMARY KEY,
    auction_lot_id              VARCHAR(36)     NOT NULL REFERENCES auction_lots(id),
    bidder_id                   VARCHAR(36)     NOT NULL,
    bidder_email                VARCHAR(255)    NOT NULL,
    stripe_payment_intent_id    VARCHAR(100)    NOT NULL,
    stripe_charge_id            VARCHAR(100),
    deposit_amount              DECIMAL(14,2)   NOT NULL,
    currency                    VARCHAR(10)     NOT NULL DEFAULT 'NAD',
    status                      VARCHAR(20)     NOT NULL DEFAULT 'PENDING',
    authorised_at               TIMESTAMP,
    released_at                 TIMESTAMP,
    charged_at                  TIMESTAMP,
    release_reason              VARCHAR(50),
    created_at                  TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deposit_lot    ON bidder_deposits(auction_lot_id);
CREATE INDEX idx_deposit_bidder ON bidder_deposits(bidder_id);
CREATE INDEX idx_deposit_status ON bidder_deposits(status);
CREATE UNIQUE INDEX idx_deposit_pi ON bidder_deposits(stripe_payment_intent_id);

-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS auction_room_presence (
    id              VARCHAR(36) PRIMARY KEY,
    auction_lot_id  VARCHAR(36)     NOT NULL,
    session_id      VARCHAR(100)    NOT NULL,
    user_id         VARCHAR(36),
    user_email      VARCHAR(255),
    ip_address      VARCHAR(64),
    joined_at       TIMESTAMP       NOT NULL DEFAULT NOW(),
    left_at         TIMESTAMP,
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_presence_lot     ON auction_room_presence(auction_lot_id);
CREATE INDEX idx_presence_session ON auction_room_presence(session_id);
CREATE INDEX idx_presence_active  ON auction_room_presence(is_active);
