import { getHealthSnapshot } from "../services/health.server";

export const loader = async () => {
  const snapshot = await getHealthSnapshot();
  return Response.json(snapshot, {
    status: snapshot.status === "ok" ? 200 : 503,
  });
};

export default function HealthRoute() {
  return null;
}
