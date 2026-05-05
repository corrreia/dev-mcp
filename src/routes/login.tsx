import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/ui/app";

export const Route = createFileRoute("/login")({
  component: LoginPage
});
