package com.staysphere.auctionservice.repository;

import com.staysphere.auctionservice.model.AuctionLot;
import com.staysphere.auctionservice.model.AuctionLotStatus;
import com.staysphere.auctionservice.model.AuctionType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface AuctionLotRepository extends JpaRepository<AuctionLot, String> {

    Page<AuctionLot> findByStatusOrderByStartsAtAsc(AuctionLotStatus status, Pageable pageable);

    Page<AuctionLot> findByStatusInOrderByStartsAtAsc(List<AuctionLotStatus> statuses, Pageable pageable);

    Page<AuctionLot> findBySellerIdOrderByCreatedAtDesc(String sellerId, Pageable pageable);

    Page<AuctionLot> findByPropertyIdOrderByCreatedAtDesc(String propertyId, Pageable pageable);

    // Lots whose scheduled start time has passed and are still SCHEDULED
    @Query("SELECT l FROM AuctionLot l WHERE l.status = 'SCHEDULED' AND l.startsAt <= :now")
    List<AuctionLot> findLotsReadyToOpen(@Param("now") LocalDateTime now);

    // Lots whose scheduled end time has passed and are still OPEN or EXTENDED
    @Query("SELECT l FROM AuctionLot l WHERE l.status IN ('OPEN','EXTENDED') AND l.scheduledEndsAt <= :now")
    List<AuctionLot> findLotsReadyToClose(@Param("now") LocalDateTime now);

    // Live lots (OPEN or EXTENDED) ordered by urgency
    @Query("SELECT l FROM AuctionLot l WHERE l.status IN ('OPEN','EXTENDED') ORDER BY l.scheduledEndsAt ASC")
    List<AuctionLot> findAllLiveLots();

    // Lots starting in the next N hours (for reminder notifications)
    @Query("SELECT l FROM AuctionLot l WHERE l.status = 'SCHEDULED' AND l.startsAt BETWEEN :from AND :until")
    List<AuctionLot> findLotsStartingSoon(@Param("from") LocalDateTime from, @Param("until") LocalDateTime until);

    @Query("SELECT l FROM AuctionLot l WHERE l.status = 'SCHEDULED' AND l.auctionType = :type AND l.startsAt BETWEEN :from AND :until")
    List<AuctionLot> findLotsStartingSoonByType(@Param("type") AuctionType type, @Param("from") LocalDateTime from, @Param("until") LocalDateTime until);

    long countByStatus(AuctionLotStatus status);
}
