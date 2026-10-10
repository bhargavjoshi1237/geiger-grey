const isProd = process.env.NODE_ENV === "production";

const nextConfig = {
  basePath: isProd ? "/grey" : "",
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: ["@geiger/ui", "@geiger/notify"],
  env: { NEXT_PUBLIC_BASE_PATH: isProd ? "/grey" : "" },
};

export default nextConfig;
