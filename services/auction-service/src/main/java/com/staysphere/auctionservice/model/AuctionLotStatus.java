package com.staysphere.auctionservice.model;

public enum AuctionLotStatus {
    DRAFT,       // created but not yet published
    SCHEDULED,   // published, waiting for start time
    OPEN,        // accepting bids right now
    EXTENDED,    // anti-snipe extension active
    CLOSED,      // bidding ended, winner being determined
    SETTLED,     // winner charged, losers refunded
    CANCELLED,   // cancelled before settlement
    NO_RESERVE   // closed but reserve not met
}
