import { ipBucket } from "./ip-bucket.js";

describe("ipBucket", () => {
	it("keeps an IPv4 address as it is", () => {
		expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
	});

	it("treats an IPv4-mapped IPv6 address as IPv4", () => {
		expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
	});

	it("groups IPv6 addresses by their /64 prefix, however they are written", () => {
		const bucket = "2001:db8:abcd:12::/64";
		expect(ipBucket("2001:db8:abcd:12::1")).toBe(bucket);
		expect(ipBucket("2001:0db8:abcd:0012:ffff:1:2:3")).toBe(bucket);
		expect(ipBucket("2001:DB8:ABCD:12:0:0:0:9")).toBe(bucket);
		expect(ipBucket("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
		expect(ipBucket("::1")).toBe("0:0:0:0::/64");
	});

	it("keeps different /64 networks apart", () => {
		expect(ipBucket("2001:db8:abcd:12::1")).not.toBe(
			ipBucket("2001:db8:abcd:13::1"),
		);
	});
});
