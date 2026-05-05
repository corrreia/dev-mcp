import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/ui/app";
import { getDashboardData } from "@/server/functions/sources";

export const Route = createFileRoute("/")({
  loader: () => getDashboardData(),
  component: IndexRoute
});

function IndexRoute() {
  const data = Route.useLoaderData();
  return <Dashboard initialData={data} />;
}
