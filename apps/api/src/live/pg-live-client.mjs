export async function createPgLiveClient(config) {
	const { default: pg } = await import("pg");
	return new pg.Client(config);
}
