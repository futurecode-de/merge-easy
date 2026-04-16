<?php

declare(strict_types=1);

namespace App\Shop;

use App\Repository\UserRepository;
use App\Events\PriceChangedEvent;
<<<<<<< feature/pricing
use App\Tax\TaxCalculator;
use App\Currency\CurrencyConverter;
=======
>>>>>>> main

/**
 * Service that handles product pricing and user management.
 *
 * Branch feature/pricing adds VAT calculation and currency support.
 * Branch main adds logging and date tracking.
 */
class ProductService
{
    private string $name;
    private string $sku;

<<<<<<< feature/pricing
    private const TAX_RATE = 0.19;
    private const CURRENCY = 'EUR';

=======
>>>>>>> main

    private UserRepository $userRepository;
<<<<<<< feature/pricing
    private TaxCalculator $taxCalculator;
    private CurrencyConverter $currencyConverter;
=======
    private \Psr\Log\LoggerInterface $logger;
>>>>>>> main

    public function __construct(
        string $name,
        string $sku,
        UserRepository $userRepository,
<<<<<<< feature/pricing
        TaxCalculator $taxCalculator,
        CurrencyConverter $currencyConverter,
=======
        \Psr\Log\LoggerInterface $logger,
>>>>>>> main
    ) {
        $this->name             = $name;
        $this->sku              = $sku;
        $this->userRepository   = $userRepository;
<<<<<<< feature/pricing
        $this->taxCalculator    = $taxCalculator;
        $this->currencyConverter= $currencyConverter;
=======
        $this->logger           = $logger;
>>>>>>> main
    }

    // ── Price methods ────────────────────────────────────────────────────────

<<<<<<< feature/pricing
    private float $price = 120.00;

    public function getPrice(): float
    {
        return $this->taxCalculator->withTax($this->price, self::TAX_RATE);
    }

    public function getPriceFormatted(): string
    {
        return $this->currencyConverter->format($this->getPrice(), self::CURRENCY);
    }
=======
    private float $price = 100.00;

    public function getPrice(): float
    {
        return $this->price;
    }
>>>>>>> main

    public function setPrice(float $price): void
    {
        if ($price < 0) {
            throw new \InvalidArgumentException('Price cannot be negative');
        }
        $this->price = $price;
    }

    // ── Label & display ──────────────────────────────────────────────────────

<<<<<<< feature/pricing
    public function getLabel(): string
    {
        return strtoupper($this->name) . ' [PREMIUM] – ' . self::CURRENCY;
    }

    public function isEligibleForDiscount(): bool
    {
        return $this->price > 100;
    }

    public function getDiscountedPrice(float $percent): float
    {
        return $this->getPrice() * (1 - $percent / 100);
    }
=======
    public function getLabel(): string
    {
        return $this->name . ' (' . $this->sku . ')';
    }
>>>>>>> main

    // ── Inventory ────────────────────────────────────────────────────────────

    private int $stock = 0;

    public function getStock(): int
    {
        return $this->stock;
    }

    public function addStock(int $quantity): void
    {
        if ($quantity <= 0) {
            throw new \InvalidArgumentException('Quantity must be positive');
        }
        $this->stock += $quantity;
    }

    // ── Non-conflicting deletion: feature/pricing removed removeStock() ──────
<<<<<<< feature/pricing
=======
    public function removeStock(int $quantity): void
    {
        if ($quantity > $this->stock) {
            throw new \UnderflowException('Not enough stock');
        }
        $this->stock -= $quantity;
    }

>>>>>>> main
    // ── Non-conflicting deletion: main removed isInStock() ──────────────────
<<<<<<< feature/pricing
    public function isInStock(): bool
    {
        return $this->stock > 0;
    }

=======
>>>>>>> main
    // ── Only added in feature/pricing (non-conflicting) ─────────────────────

<<<<<<< feature/pricing
    public function getTaxAmount(): float
    {
        return $this->getPrice() - $this->price;
    }

    public function getPriceInCurrency(string $targetCurrency): float
    {
        return $this->currencyConverter->convert($this->getPrice(), self::CURRENCY, $targetCurrency);
    }
=======
>>>>>>> main

    // ── Only added in main (non-conflicting) ─────────────────────────────────

<<<<<<< feature/pricing
=======
    private ?\DateTimeImmutable $lastModified = null;

    public function touch(): void
    {
        $this->lastModified = new \DateTimeImmutable();
        $this->logger->info("Product {$this->sku} touched");
    }

    public function getLastModified(): ?\DateTimeImmutable
    {
        return $this->lastModified;
    }
>>>>>>> main

    // ── Persistence ──────────────────────────────────────────────────────────

    public function save(): void
    {
<<<<<<< feature/pricing
        $event = new PriceChangedEvent($this->sku, $this->price);
        $event->dispatch();
=======
        $this->logger->info("Saving product {$this->sku} with price {$this->price}");
        $event = new PriceChangedEvent($this->sku, $this->price);
        $event->dispatch();
        $this->touch();
>>>>>>> main
        $this->userRepository->saveProduct($this);
    }

    // ── Utility ──────────────────────────────────────────────────────────────

    public function getSku(): string
    {
        return $this->sku;
    }

    public function getName(): string
    {
        return $this->name;
    }

    public function toArray(): array
    {
        return [
            'name'  => $this->name,
            'sku'   => $this->sku,
            'price' => $this->price,
            'stock' => $this->stock,
        ];
    }

    public function __toString(): string
    {
        return sprintf('%s [%s] @ %.2f', $this->name, $this->sku, $this->price);
    }
}
