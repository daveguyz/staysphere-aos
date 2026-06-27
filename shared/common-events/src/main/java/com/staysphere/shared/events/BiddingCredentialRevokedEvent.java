package com.staysphere.shared.events;

import lombok.*;
import java.time.LocalDateTime;

@Data @Builder @NoArgsConstructor @AllArgsConstructor
public class BiddingCredentialRevokedEvent {
    public static final String TOPIC = "bid.credential-revoked";

    private String eventId;
    private String credentialId;
    private String lotId;
    private String bidderId;
    private String bidderEmail;
    private String revokeReason;
    private String revokedBy;    // auctioneer user ID
    private LocalDateTime revokedAt;
}
