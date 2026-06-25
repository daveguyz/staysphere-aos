package com.staysphere.auctionservice.model;

public enum AuctionType {
    ENGLISH,    // ascending price, highest bid wins
    DUTCH,      // descending price, first accept wins
    REVERSE,    // service auction, lowest bid wins
    SEALED_BID  // one-shot sealed bids, highest revealed at close
}
