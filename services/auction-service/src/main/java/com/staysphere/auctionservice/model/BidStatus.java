package com.staysphere.auctionservice.model;

public enum BidStatus {
    ACTIVE,    // current standing bid
    OUTBID,    // beaten by higher bid
    WINNING,   // currently the winning bid
    WON,       // auction closed, this bid won
    LOST,      // auction closed, this bid lost
    WITHDRAWN, // bidder withdrew (sealed bid only, before reveal)
    INVALID    // rejected by fraud checks
}
