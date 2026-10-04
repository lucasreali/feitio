/**
 * The unit a client's address is counted by. IPv4 addresses count alone;
 * IPv6 ones by their /64 network, which a single client usually holds
 * whole and could otherwise walk through to dodge per-address limits.
 */
export function ipBucket(ip: string): string {
	const address = ip.replace(/%.*$/, "").toLowerCase();
	if (!address.includes(":")) {
		return address;
	}
	const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	if (mapped) {
		return mapped[1];
	}
	const [head, tail] = address.split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups =
		tail === undefined
			? left
			: [
					...left,
					...Array(8 - left.length - right.length).fill("0"),
					...right,
				];
	const prefix = groups
		.slice(0, 4)
		.map((group) => Number.parseInt(group, 16).toString(16));
	return `${prefix.join(":")}::/64`;
}
