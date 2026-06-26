package com.staysphere.auctionservice;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.*;
import com.staysphere.auctionservice.service.AuctionLotService;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@DisplayName("Auction Lot State Machine Tests")
class AuctionLotStateMachineTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("staysphere_auction")
            .withUsername("staysphere")
            .withPassword("staysphere_secret");

    @Container
    @SuppressWarnings("resource")
    static GenericContainer<?> redis = new GenericContainer<>(
            DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    @DynamicPropertySource
    static void setProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",         postgres::getJdbcUrl);
        registry.add("spring.datasource.username",    postgres::getUsername);
        registry.add("spring.datasource.password",    postgres::getPassword);
        registry.add("spring.flyway.enabled",         () -> true);
        registry.add("spring.data.redis.host",        redis::getHost);
        registry.add("spring.data.redis.port",        () -> redis.getMappedPort(6379));
        registry.add("spring.autoconfigure.exclude",
                () -> "org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration");
        registry.add("spring.data.elasticsearch.repositories.enabled", () -> false);
        registry.add("stripe.secret-key", () -> "sk_test_stub");
        registry.add("anthropic.api.key", () -> "");
        registry.add("mux.token-id",      () -> "");
        registry.add("mux.token-secret",  () -> "");
    }

    @Autowired AuctionLotService lotService;
    @Autowired AuctionLotRepository lotRepository;
    @Autowired BidRepository bidRepository;
    @Autowired BidderDepositRepository depositRepository;

    @MockBean org.springframework.kafka.core.KafkaTemplate<String, Object> kafkaTemplate;

    @BeforeEach
    void setup() {
        bidRepository.deleteAll();
        depositRepository.deleteAll();
        lotRepository.deleteAll();
    }

    private AuctionLot savedDraftLot() {
        return lotRepository.save(AuctionLot.builder()
                .propertyId("p1").sellerId("seller-1").title("State Machine Test")
                .auctionType(AuctionType.ENGLISH).status(AuctionLotStatus.DRAFT)
                .startsAt(LocalDateTime.now().plusHours(1))
                .scheduledEndsAt(LocalDateTime.now().plusHours(3))
                .startingPrice(BigDecimal.valueOf(1_000))
                .minimumBidIncrement(BigDecimal.valueOf(100))
                .currency("NAD").antiSnipeEnabled(true)
                .antiSnipeTriggerSeconds(300).antiSnipeExtensionSeconds(300)
                .maxAntiSnipeExtensions(10).antiSnipeExtensionCount(0)
                .depositRequired(false).kycRequired(false)
                .totalBids(0).uniqueBidders(0)
                .build());
    }

    @Test
    @DisplayName("DRAFT → SCHEDULED via publishLot()")
    void draft_toScheduled_viaPublish() {
        AuctionLot lot = savedDraftLot();
        AuctionLot published = lotService.publishLot(lot.getId(), "seller-1");
        assertThat(published.getStatus()).isEqualTo(AuctionLotStatus.SCHEDULED);
    }

    @Test
    @DisplayName("SCHEDULED → OPEN via openLot()")
    void scheduled_toOpen_viaOpen() {
        AuctionLot lot = savedDraftLot();
        lot.setStatus(AuctionLotStatus.SCHEDULED);
        lotRepository.save(lot);

        AuctionLot opened = lotService.openLot(lot.getId());
        assertThat(opened.getStatus()).isEqualTo(AuctionLotStatus.OPEN);
    }

    @Test
    @DisplayName("OPEN → CLOSED via closeLot() with no bids → NO_RESERVE")
    void open_toClosed_noBids_noReserve() {
        AuctionLot lot = savedDraftLot();
        lot.setStatus(AuctionLotStatus.OPEN);
        lotRepository.save(lot);

        AuctionLot closed = lotService.closeLot(lot.getId());
        assertThat(closed.getStatus()).isEqualTo(AuctionLotStatus.NO_RESERVE);
        assertThat(closed.getWinnerId()).isNull();
    }

    @Test
    @DisplayName("OPEN → CLOSED with winner when bids present")
    void open_toClosed_withWinner() {
        AuctionLot lot = savedDraftLot();
        lot.setStatus(AuctionLotStatus.OPEN);
        lotRepository.save(lot);

        // Place a bid manually
        bidRepository.save(Bid.builder()
                .auctionLotId(lot.getId())
                .bidderId("winning-bidder").bidderEmail("winner@test.com")
                .amount(BigDecimal.valueOf(2_000))
                .status(BidStatus.WINNING).currency("NAD").bidSequence(1L)
                .build());

        AuctionLot closed = lotService.closeLot(lot.getId());
        assertThat(closed.getStatus()).isEqualTo(AuctionLotStatus.CLOSED);
        assertThat(closed.getWinnerId()).isEqualTo("winning-bidder");
        assertThat(closed.getWinningAmount()).isEqualByComparingTo(BigDecimal.valueOf(2_000));
    }

    @Test
    @DisplayName("Reserve price not met → NO_RESERVE status")
    void reserveNotMet_setsNoReserveStatus() {
        AuctionLot lot = savedDraftLot();
        lot.setStatus(AuctionLotStatus.OPEN);
        lot.setReservePrice(BigDecimal.valueOf(10_000)); // High reserve
        lotRepository.save(lot);

        bidRepository.save(Bid.builder()
                .auctionLotId(lot.getId())
                .bidderId("low-bidder").bidderEmail("low@test.com")
                .amount(BigDecimal.valueOf(1_500)) // Below reserve
                .status(BidStatus.WINNING).currency("NAD").bidSequence(1L)
                .build());

        AuctionLot closed = lotService.closeLot(lot.getId());
        assertThat(closed.getStatus()).isEqualTo(AuctionLotStatus.NO_RESERVE);
    }

    @Test
    @DisplayName("Cannot publish a lot that isn't DRAFT")
    void cannotPublish_nonDraftLot() {
        AuctionLot lot = savedDraftLot();
        lot.setStatus(AuctionLotStatus.OPEN);
        lotRepository.save(lot);

        assertThrows(IllegalStateException.class,
                () -> lotService.publishLot(lot.getId(), "seller-1"));
    }

    @Test
    @DisplayName("Cannot open a lot that isn't SCHEDULED")
    void cannotOpen_nonScheduledLot() {
        AuctionLot lot = savedDraftLot();
        // Still DRAFT
        assertThrows(IllegalStateException.class,
                () -> lotService.openLot(lot.getId()));
    }

    @Test
    @DisplayName("Non-owner cannot modify a lot")
    void nonOwner_cannotModifyLot() {
        AuctionLot lot = savedDraftLot(); // sellerId = "seller-1"

        assertThrows(SecurityException.class,
                () -> lotService.publishLot(lot.getId(), "intruder-999"));
    }

    @Test
    @DisplayName("Dutch lot initialises currentBidAmount to dutchStartPrice on open")
    void dutchLot_initialisesCurrentBidOnOpen() {
        AuctionLot lot = lotRepository.save(AuctionLot.builder()
                .propertyId("p2").sellerId("seller-1").title("Dutch Test")
                .auctionType(AuctionType.DUTCH).status(AuctionLotStatus.SCHEDULED)
                .startsAt(LocalDateTime.now().minusMinutes(1))
                .scheduledEndsAt(LocalDateTime.now().plusHours(1))
                .startingPrice(BigDecimal.valueOf(1_000))
                .dutchStartPrice(BigDecimal.valueOf(5_000))
                .dutchFloorPrice(BigDecimal.valueOf(500))
                .dutchDecrementAmount(BigDecimal.valueOf(250))
                .dutchDecrementIntervalSeconds(60)
                .minimumBidIncrement(BigDecimal.valueOf(100))
                .currency("NAD").antiSnipeEnabled(false)
                .depositRequired(false).kycRequired(false)
                .totalBids(0).uniqueBidders(0).antiSnipeExtensionCount(0)
                .build());

        AuctionLot opened = lotService.openLot(lot.getId());
        assertThat(opened.getCurrentBidAmount())
                .isEqualByComparingTo(BigDecimal.valueOf(5_000));
    }
}
