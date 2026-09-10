import {
  SuiGrpcClient,
  type GrpcWebOptions,
} from "@mysten/sui/grpc";

const SUI_GRPC_NETWORK = "localnet" as const;
const SUI_GRPC_BASE_URL = "http://localhost:9000";
const SUI_GRPC_CLIENT_OPTIONS = Object.freeze({
  network: SUI_GRPC_NETWORK,
  baseUrl: SUI_GRPC_BASE_URL,
});

type SuiGrpcTransportOptions = Partial<Omit<GrpcWebOptions, "baseUrl">>;

function buildSuiClientGlobalConfigEntries(
  clientCompatibilityProfile: unknown,
): Array<[string, string]> {
  return String(clientCompatibilityProfile || "")
    .trim()
    .toLowerCase() === "frontier"
    ? [["sui_network", SUI_GRPC_NETWORK]]
    : [];
}

function createSuiGrpcClient(
  transportOptions: SuiGrpcTransportOptions = {},
): SuiGrpcClient {
  return new SuiGrpcClient({
    ...transportOptions,
    ...SUI_GRPC_CLIENT_OPTIONS,
  });
}

const suiGrpcClient = createSuiGrpcClient();

export {
  SuiGrpcClient,
  SUI_GRPC_BASE_URL,
  SUI_GRPC_CLIENT_OPTIONS,
  SUI_GRPC_NETWORK,
  buildSuiClientGlobalConfigEntries,
  createSuiGrpcClient,
  suiGrpcClient,
};
