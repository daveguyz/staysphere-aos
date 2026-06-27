package com.staysphere.auctionservice.model;

public enum CredentialStatus {
    ACTIVE,   // credential is valid — bidder may place bids
    REVOKED,  // revoked by auctioneer mid-auction (Rule 11.3)
    EXPIRED   // lot has closed or expiry time passed
}
