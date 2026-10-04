import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	return (
		<main className="p-8">
			<h1 className="font-semibold text-2xl">Storefront Starter</h1>
			<p className="mt-2 text-muted-foreground">
				Projeto-base das lojas Feitio.
			</p>
		</main>
	);
}
