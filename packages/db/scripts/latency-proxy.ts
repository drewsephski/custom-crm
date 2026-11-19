import { connect, createServer, type Socket } from "node:net";

const listenPort = Number(process.env.LATENCY_PROXY_PORT ?? "6543");
const targetHost = process.env.LATENCY_PROXY_TARGET_HOST ?? "127.0.0.1";
const targetPort = Number(process.env.LATENCY_PROXY_TARGET_PORT ?? "5433");
const oneWayMs = Number(process.env.LATENCY_PROXY_ONE_WAY_MS ?? "10");

function delayed(from: Socket, to: Socket) {
	from.on("data", (chunk) => {
		setTimeout(() => {
			if (!to.destroyed) to.write(chunk);
		}, oneWayMs);
	});
	from.on("close", () => setTimeout(() => to.destroy(), oneWayMs));
	from.on("error", () => to.destroy());
}

createServer((client) => {
	client.setNoDelay(true);
	const upstream = connect(targetPort, targetHost);
	upstream.setNoDelay(true);
	delayed(client, upstream);
	delayed(upstream, client);
}).listen(listenPort, "127.0.0.1", () => {
	console.log(
		`latency proxy 127.0.0.1:${listenPort} -> ${targetHost}:${targetPort}, ${oneWayMs}ms each way`,
	);
});
