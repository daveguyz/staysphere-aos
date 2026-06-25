package com.staysphere.auctionservice.model;

public enum DepositStatus {
    PENDING,   // PaymentIntent created, not yet authorised
    HELD,      // deposit successfully authorised / on hold
    RELEASED,  // bidder lost, deposit released
    CHARGED,   // bidder won, deposit charged towards purchase
    FAILED,    // authorisation failed
    EXPIRED    // hold expired (Stripe max 7 days for auth holds)
}
