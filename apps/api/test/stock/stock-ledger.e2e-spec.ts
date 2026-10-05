import { ConflictException, NotFoundException } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { asc, eq } from "drizzle-orm";
import { productVariants } from "../../src/database/schemas/product-variants.js";
import { products } from "../../src/database/schemas/products.js";
import { stockLevels } from "../../src/database/schemas/stock-levels.js";
import { stockLocations } from "../../src/database/schemas/stock-locations.js";
import {
	type StockMovementKind,
	stockMovements,
} from "../../src/database/schemas/stock-movements.js";
import { ProductVariantId } from "../../src/domain/ids.js";
import type { Money } from "../../src/domain/money.js";
import type { Sku } from "../../src/domain/sku.js";
import type { Slug } from "../../src/domain/slug.js";
import { moveStock, type StockLine } from "../../src/stock/stock-ledger.js";
import { TenantContext } from "../../src/tenancy/tenant-context.js";
import {
	TenantDatabase,
	type TenantTransaction,
} from "../../src/tenancy/tenant-database.js";
import {
	Fixtures,
	startApp,
	storeEvents,
	type TestTenant,
} from "../fixtures.js";

// Runs against the real PostgreSQL in .env.test.
describe("Stock ledger (e2e)", () => {
	let app: NestFastifyApplication;
	let fixtures: Fixtures;
	let store: TestTenant;

	const inStore = <T>(fn: (tx: TenantTransaction) => Promise<T>) =>
		TenantContext.run(store, () => app.get(TenantDatabase).run(fn));
	const move = (kind: StockMovementKind, lines: StockLine[]) =>
		inStore((tx) => moveStock(tx, kind, lines));
	const line = (variantId: ProductVariantId, quantity: number) => ({
		variantId,
		quantity,
	});

	/** A new variant (in a new product) with the given stock policy. */
	const variant = (
		policy: { trackStock?: boolean; allowBackorder?: boolean } = {},
	) =>
		inStore(async (tx) => {
			const suffix = crypto.randomUUID().slice(0, 8);
			const [product] = await tx
				.insert(products)
				.values({
					tenantId: store.id,
					name: "Shirt",
					slug: `shirt-${suffix}` as Slug,
				})
				.returning({ id: products.id });
			const [row] = await tx
				.insert(productVariants)
				.values({
					tenantId: store.id,
					productId: product.id,
					sku: `SKU-${suffix}` as Sku,
					price: 1290 as Money,
					position: 0,
					...policy,
				})
				.returning({ id: productVariants.id });
			return row.id;
		});
	const level = (variantId: ProductVariantId) =>
		inStore(async (tx) => {
			const [row] = await tx
				.select({
					available: stockLevels.available,
					reserved: stockLevels.reserved,
				})
				.from(stockLevels)
				.where(eq(stockLevels.variantId, variantId));
			return row ?? null;
		});
	const movements = (variantId: ProductVariantId) =>
		inStore((tx) =>
			tx
				.select({
					kind: stockMovements.kind,
					quantity: stockMovements.quantity,
				})
				.from(stockMovements)
				.where(eq(stockMovements.variantId, variantId))
				.orderBy(asc(stockMovements.id)),
		);
	/** A tracked variant with `available` units. */
	const stocked = async (available: number) => {
		const id = await variant();
		await move("adjustment", [line(id, available)]);
		return id;
	};

	beforeAll(async () => {
		app = await startApp();
		fixtures = await Fixtures.open();
		store = await fixtures.tenant();
	});

	afterAll(async () => {
		await fixtures.close();
		await app.close();
	});

	it("keeps the stock in one default location, created with the first write", async () => {
		const [a, b] = await Promise.all([variant(), variant()]);
		await Promise.all([
			move("adjustment", [line(a, 1)]),
			move("adjustment", [line(b, 1)]),
		]);

		const locations = await inStore((tx) =>
			tx
				.select({ isDefault: stockLocations.isDefault })
				.from(stockLocations),
		);
		expect(locations).toEqual([{ isDefault: true }]);
	});

	it("adds and removes available units by adjustment, never below zero", async () => {
		const id = await variant();
		expect(await level(id)).toBeNull();

		await move("adjustment", [line(id, 5)]);
		await move("adjustment", [line(id, -2)]);
		await expect(move("adjustment", [line(id, -4)])).rejects.toThrow(
			ConflictException,
		);

		expect(await level(id)).toEqual({ available: 3, reserved: 0 });
		expect(await movements(id)).toEqual([
			{ kind: "adjustment", quantity: 5 },
			{ kind: "adjustment", quantity: -2 },
		]);
	});

	it("reserves, sells, releases and takes back returned units", async () => {
		const id = await stocked(10);

		await move("reservation", [line(id, 4)]);
		expect(await level(id)).toEqual({ available: 6, reserved: 4 });
		await move("sale", [line(id, 3)]);
		expect(await level(id)).toEqual({ available: 6, reserved: 1 });
		await move("release", [line(id, 1)]);
		expect(await level(id)).toEqual({ available: 7, reserved: 0 });
		await move("return", [line(id, 2)]);
		expect(await level(id)).toEqual({ available: 9, reserved: 0 });

		expect(await movements(id)).toEqual([
			{ kind: "adjustment", quantity: 10 },
			{ kind: "reservation", quantity: 4 },
			{ kind: "sale", quantity: 3 },
			{ kind: "release", quantity: 1 },
			{ kind: "return", quantity: 2 },
		]);
	});

	it.each([
		["sell", "sale"],
		["release", "release"],
	] as const)("refuses to %s more than is reserved", async (_verb, kind) => {
		const id = await stocked(5);
		await move("reservation", [line(id, 2)]);

		await expect(move(kind, [line(id, 3)])).rejects.toThrow(
			ConflictException,
		);
		expect(await level(id)).toEqual({ available: 3, reserved: 2 });
	});

	it("refuses to reserve more than is available, and reserves all lines or none", async () => {
		const [plenty, scarce] = await Promise.all([stocked(5), stocked(1)]);

		await expect(
			move("reservation", [line(plenty, 2), line(scarce, 2)]),
		).rejects.toThrow(ConflictException);

		expect(await level(plenty)).toEqual({ available: 5, reserved: 0 });
		expect(await level(scarce)).toEqual({ available: 1, reserved: 0 });
		expect(await movements(scarce)).toHaveLength(1);
	});

	it("reserves past zero when the variant allows backorders", async () => {
		const id = await variant({ allowBackorder: true });

		await move("reservation", [line(id, 2)]);

		expect(await level(id)).toEqual({ available: -2, reserved: 2 });
	});

	it("publishes one stock.changed event with the lines that moved", async () => {
		const [tracked, untracked] = await Promise.all([
			stocked(5),
			variant({ trackStock: false }),
		]);
		const before = (await storeEvents(app, store)).length;

		await move("reservation", [line(untracked, 1), line(tracked, 2)]);
		await move("sale", [line(untracked, 1)]);
		await expect(move("reservation", [line(tracked, 9)])).rejects.toThrow(
			ConflictException,
		);

		expect((await storeEvents(app, store)).slice(before)).toEqual([
			{
				type: "stock.changed",
				payload: {
					kind: "reservation",
					lines: [{ variantId: tracked, quantity: 2 }],
				},
				dispatchedAt: null,
			},
		]);
	});

	it("moves nothing for an order of a variant that does not track stock", async () => {
		const id = await variant({ trackStock: false });

		await move("reservation", [line(id, 3)]);
		await move("sale", [line(id, 3)]);

		expect(await level(id)).toBeNull();
		expect(await movements(id)).toEqual([]);
	});

	it("sells the last unit only once under concurrent reservations", async () => {
		const id = await stocked(1);

		const results = await Promise.allSettled(
			Array.from({ length: 5 }, () => move("reservation", [line(id, 1)])),
		);

		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(await level(id)).toEqual({ available: 0, reserved: 1 });
	});

	it("does not deadlock when concurrent orders reserve the same variants in any order", async () => {
		const [a, b] = await Promise.all([stocked(10), stocked(10)]);

		await Promise.all([
			move("reservation", [line(a, 1), line(b, 1)]),
			move("reservation", [line(b, 1), line(a, 1)]),
			move("reservation", [line(a, 1), line(b, 1)]),
		]);

		expect(await level(a)).toEqual({ available: 7, reserved: 3 });
		expect(await level(b)).toEqual({ available: 7, reserved: 3 });
	});

	it("answers 404 for a variant the store does not have", async () => {
		await expect(
			move("adjustment", [line(ProductVariantId.generate(), 1)]),
		).rejects.toThrow(NotFoundException);
	});
});
