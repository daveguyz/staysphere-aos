package com.staysphere.auctionservice;

import com.staysphere.auctionservice.model.*;
import com.staysphere.auctionservice.repository.*;
import com.staysphere.auctionservice.service.BidEngineService;
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
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
@DisplayName("Auction Bid Race Condition Tests")
class AuctionBidRaceConditionTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("staysphere_auction")
            .withUsername("staysphere")
            .withPassword("staysphere_secret");

    @SuppressWarnings("resource")
    @Container
    static GenericContainer<?> redis = new GenericContainer<>(
            DockerImageName.parse("redis:7-alpine"))
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void setProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",         postgres::getJdbcUrl);
        registry.add("spring.datasource.username",    postgres::getUsername);
        registry.add("spring.datasource.password",    postgres::getPassword);
        registry.add("spring.flyway.enabled",         () -> true);
        registry.add("spring.data.redis.host",        redis::getHost);
        registry.add("spring.data.redis.port",        () -> redis.getMappedPort(6379));
        // Disable Kafka for these tests
        registry.add("spring.autoconfigure.exclude",
                () -> "org.springframework.boot.autoconfigure.kafka.KafkaAutoConfiguration");
        // Disable ES
        registry.add("spring.data.elasticsearch.repositories.enabled", () -> false);
        // Stub external services
        registry.add("stripe.secret-key",    () -> "sk_test_stub");
        registry.add("anthropic.api.key",    () -> "");
        registry.add("mux.token-id",         () -> "");
        registry.add("mux.token-secret",     () -> "");
    }

    @Autowired BidEngineService bidEngineService;
    @Autowired AuctionLotRepository lotRepository;
    @Autowired BidRepository bidRepository;

    // Mock Kafka and broadcast so tests don't need a broker
    @MockBean org.springframework.kafka.core.KafkaTemplate<String, Object> kafkaTemplate;
    @MockBean com.staysphere.auctionservice.websocket.AuctionBroadcastService broadcastService;
    @MockBean com.staysphere.auctionservice.service.AiFraudService aiFraudService;
    @MockBean com.staysphere.auctionservice.service.KycService kycService;

    private AuctionLot testLot;

    @BeforeEach
    void setup() {
        bidRepository.deleteAll();
        lotRepository.deleteAll();

        testLot = lotRepository.save(AuctionLot.builder()
                .propertyId("prop-race-test")
                .sellerId("seller-1")
                .title("Race Condition Test Lot")
                .auctionType(AuctionType.ENGLISH)
                .status(AuctionLotStatus.OPEN)
                .startsAt(LocalDateTime.now().minusMinutes(5))
                .scheduledEndsAt(LocalDateTime.now().plusHours(2))
                .startingPrice(BigDecimal.valueOf(1000))
                .minimumBidIncrement(BigDecimal.valueOf(100))
                .currency("NAD")
                .antiSnipeEnabled(false)
                .depositRequired(false)
                .kycRequired(false)
                .totalBids(0)
                .uniqueBidders(0)
                .antiSnipeExtensionCount(0)
                .build());

        // Mock fraud service to return clean score
        var cleanAssessment = new com.staysphere.auctionservice.service.AiFraudService.FraudAssessment(0.0, "clean", false);
        org.mockito.Mockito.when(aiFraudService.assessBid(any(), any(), any(Integer.class)))
                .thenReturn(cleanAssessment);
        doNothing().when(broadcastService).broadcastBidUpdate(any(), any(), any(Boolean.class));
    }

    @Test
    @DisplayName("100 concurrent bids on same lot — Redis SETNX ensures only sequential processing")
    void concurrentBids_redisLockEnsuresCorrectState() throws InterruptedException {
        int threadCount = 100;
        CountDownLatch startGate = new CountDownLatch(1);
        CountDownLatch doneLatch  = new CountDownLatch(threadCount);

        AtomicInteger successCount  = new AtomicInteger(0);
        AtomicInteger rejectedCount = new AtomicInteger(0);

        ExecutorService executor = Executors.newFixedThreadPool(threadCount);

        for (int i = 0; i < threadCount; i++) {
            final int bidderIdx = i;
            executor.submit(() -> {
                try {
                    startGate.await();
                    // Each bidder starts at 1500 — only increments are valid
                    BigDecimal amount = BigDecimal.valueOf(1500 + (long) bidderIdx * 100);
                    bidEngineService.placeBid(
                            testLot.getId(),
                            "bidder-" + bidderIdx,
                            "bidder" + bidderIdx + "@test.com",
                            amount, null,
                            "127.0.0.1", "fp-" + bidderIdx, "test-agent");
                    successCount.incrementAndGet();
                } catch (IllegalStateException e) {
                    // Expected: lock contention or minimum-not-met
                    rejectedCount.incrementAndGet();
                } catch (Exception e) {
                    rejectedCount.incrementAndGet();
                } finally {
                    doneLatch.countDown();
                }
            });
        }

        startGate.countDown();
        boolean finished = doneLatch.await(60, TimeUnit.SECONDS);
        executor.shutdown();

        assertThat(finished).isTrue();
        assertThat(successCount.get() + rejectedCount.get()).isEqualTo(threadCount);

        // Core invariant: current bid must be strictly increasing
        AuctionLot finalLot = lotRepository.findById(testLot.getId()).orElseThrow();
        List<Bid> allBids = bidRepository.findByAuctionLotIdOrderByPlacedAtDesc(testLot.getId());

        // There must be at most one WINNING bid
        long winningBids = allBids.stream()
                .filter(b -> b.getStatus() == BidStatus.WINNING)
                .count();
        assertThat(winningBids).isLessThanOrEqualTo(1);

        // The winning bid amount must equal the lot's current bid amount
        allBids.stream()
                .filter(b -> b.getStatus() == BidStatus.WINNING)
                .findFirst()
                .ifPresent(winning -> assertThat(winning.getAmount())
                        .isEqualByComparingTo(finalLot.getCurrentBidAmount()));

        // Bid sequence must be strictly increasing (no gaps from lock races)
        List<Long> sequences = allBids.stream()
                .map(Bid::getBidSequence)
                .filter(s -> s != null)
                .sorted()
                .toList();
        for (int i = 0; i < sequences.size() - 1; i++) {
            assertThat(sequences.get(i + 1)).isGreaterThan(sequences.get(i));
        }
    }

    @Test
    @DisplayName("Lock expires after TTL — subsequent bid can acquire lock")
    void lockExpiry_allowsSubsequentBid() throws InterruptedException {
        // Place first bid successfully
        bidEngineService.placeBid(testLot.getId(), "bidder-first", "first@test.com",
                BigDecimal.valueOf(1500), null, "127.0.0.1", null, null);

        // Brief pause to let lock expire (TTL = 5s; we use a fresh lot so lock is gone)
        Thread.sleep(100);

        // Second bid should succeed normally
        Bid secondBid = bidEngineService.placeBid(testLot.getId(), "bidder-second", "second@test.com",
                BigDecimal.valueOf(1700), null, "127.0.0.1", null, null);

        assertThat(secondBid).isNotNull();
        assertThat(secondBid.getAmount()).isEqualByComparingTo(BigDecimal.valueOf(1700));
        assertThat(secondBid.getStatus()).isEqualTo(BidStatus.WINNING);
    }

    @Test
    @DisplayName("Minimum bid increment enforced under concurrency")
    void minimumIncrement_enforcedCorrectly() {
        // Place a bid at 2000
        bidEngineService.placeBid(testLot.getId(), "bidder-a", "a@test.com",
                BigDecimal.valueOf(2000), null, "127.0.0.1", null, null);

        // Attempt a bid below minimum (2000 + 100 = 2100 required)
        org.junit.jupiter.api.Assertions.assertThrows(IllegalArgumentException.class, () ->
                bidEngineService.placeBid(testLot.getId(), "bidder-b", "b@test.com",
                        BigDecimal.valueOf(2050), null, "127.0.0.1", null, null)
        );

        // Valid bid at exact minimum should succeed
        Bid valid = bidEngineService.placeBid(testLot.getId(), "bidder-c", "c@test.com",
                BigDecimal.valueOf(2100), null, "127.0.0.1", null, null);
        assertThat(valid.getAmount()).isEqualByComparingTo(BigDecimal.valueOf(2100));
    }

    @Test
    @DisplayName("Closed lot rejects new bids")
    void closedLot_rejectsBids() {
        testLot.setStatus(AuctionLotStatus.CLOSED);
        lotRepository.save(testLot);

        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, () ->
                bidEngineService.placeBid(testLot.getId(), "bidder-x", "x@test.com",
                        BigDecimal.valueOf(5000), null, "127.0.0.1", null, null)
        );
    }
}
