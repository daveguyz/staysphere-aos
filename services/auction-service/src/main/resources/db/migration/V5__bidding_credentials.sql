-- Phase 5: Secure bidding credentials
-- A time-limited, lot-scoped token issued after deposit confirmation.
-- The plaintext token is never stored — only the SHA-256 hex digest.

CREATE TABLE IF NOT EXISTS bidding_credentials (
    id              VARCHAR(36)     NOT NULL PRIMARY KEY,
    lot_id          VARCHAR(36)     NOT NULL REFERENCES auction_lots(id),
    bidder_id       VARCHAR(36)     NOT NULL,
    bidder_email    VARCHAR(255),
    deposit_id      VARCHAR(36)     NOT NULL UNIQUE,   -- one credential per deposit
    token_hash      VARCHAR(64)     NOT NULL UNIQUE,   -- SHA-256 hex of plaintext token
    ip_issued_to    VARCHAR(64),                       -- IP at deposit time (fraud baseline)
    status          VARCHAR(10)     NOT NULL DEFAULT 'ACTIVE',
    issued_at       TIMESTAMP       NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMP       NOT NULL,
    bid_count_used  INTEGER         NOT NULL DEFAULT 0,
    revoke_reason   TEXT,
    revoked_by      VARCHAR(36),
    revoked_at      TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cred_lot    ON bidding_credentials(lot_id);
CREATE INDEX IF NOT EXISTS idx_cred_bidder ON bidding_credentials(bidder_id);
CREATE INDEX IF NOT EXISTS idx_cred_status ON bidding_credentials(status);
-- token_hash and deposit_id already have UNIQUE constraints above

-- Add credential_id to bids for audit trail (Phase 6 will use this)
ALTER TABLE bids ADD COLUMN IF NOT EXISTS credential_id VARCHAR(36);
CREATE INDEX IF NOT EXISTS idx_bid_credential ON bids(credential_id);

COMMENT ON TABLE bidding_credentials IS
    'Lot-scoped cryptographic credentials. Plaintext token never stored — only SHA-256 hash.';
COMMENT ON COLUMN bidding_credentials.token_hash IS
    'SHA-256 hex digest of the UUID token delivered to the client once after deposit.';
COMMENT ON COLUMN bidding_credentials.ip_issued_to IS
    'IP address at time of deposit — used as fraud baseline in Phase 6.';
COMMENT ON COLUMN bids.credential_id IS
    'FK to bidding_credentials — every bid traceable to the credential that authorised it.';
