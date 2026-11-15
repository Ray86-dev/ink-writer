import { describe, expect, it } from "vitest";
import { assetName, buildManifest } from "./update-manifest.mjs";

const release = {
  version: "0.2.0",
  notes: "Ink Writer 0.2.0",
  date: "2026-12-01T10:00:00.000Z",
  repository: "someone/ink-writer",
  tag: "v0.2.0",
};

describe("the file that announces a version", () => {
  it("names each installer the way the release will hold it", () => {
    expect(assetName("Ink Writer_0.2.0_x64-setup.exe", "0.2.0")).toBe(
      "Ink.Writer_0.2.0_x64-setup.exe",
    );
    expect(assetName("Ink Writer_0.2.0_amd64.AppImage", "0.2.0")).toBe(
      "Ink.Writer_0.2.0_amd64.AppImage",
    );
    // The macOS archive says neither version nor architecture.
    expect(assetName("Ink Writer.app.tar.gz", "0.2.0")).toBe("Ink.Writer_0.2.0_aarch64.app.tar.gz");
    expect(assetName("Ink Writer.app.tar.gz.sig", "0.2.0")).toBe(
      "Ink.Writer_0.2.0_aarch64.app.tar.gz.sig",
    );
    expect(assetName("Ink.Writer_0.2.0_aarch64.app.tar.gz", "0.2.0")).toBe(
      "Ink.Writer_0.2.0_aarch64.app.tar.gz",
    );
  });

  it("gives each system its installer, its signature and where to download it", () => {
    const manifest = buildManifest({
      ...release,
      files: [
        "Ink.Writer_0.2.0_x64-setup.exe",
        "Ink.Writer_0.2.0_amd64.AppImage",
        "Ink.Writer_0.2.0_amd64.deb",
        "Ink.Writer_0.2.0_aarch64.dmg",
        "Ink.Writer_0.2.0_aarch64.app.tar.gz",
        "SHA256SUMS.txt",
      ],
      signatures: {
        "Ink.Writer_0.2.0_x64-setup.exe": "sig-windows",
        "Ink.Writer_0.2.0_amd64.AppImage": "sig-linux",
        "Ink.Writer_0.2.0_aarch64.app.tar.gz": "sig-mac",
      },
    });

    expect(manifest).toEqual({
      version: "0.2.0",
      notes: "Ink Writer 0.2.0",
      pub_date: "2026-12-01T10:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          signature: "sig-windows",
          url: "https://github.com/someone/ink-writer/releases/download/v0.2.0/Ink.Writer_0.2.0_x64-setup.exe",
        },
        "linux-x86_64": {
          signature: "sig-linux",
          url: "https://github.com/someone/ink-writer/releases/download/v0.2.0/Ink.Writer_0.2.0_amd64.AppImage",
        },
        "darwin-aarch64": {
          signature: "sig-mac",
          url: "https://github.com/someone/ink-writer/releases/download/v0.2.0/Ink.Writer_0.2.0_aarch64.app.tar.gz",
        },
      },
    });
  });

  it("never announces an installer that isn't signed", () => {
    const manifest = buildManifest({
      ...release,
      files: ["Ink.Writer_0.2.0_x64-setup.exe", "Ink.Writer_0.2.0_amd64.AppImage"],
      signatures: { "Ink.Writer_0.2.0_amd64.AppImage": "sig-linux" },
    });

    expect(Object.keys(manifest.platforms)).toEqual(["linux-x86_64"]);
  });

  it("is not written at all if nothing is signed", () => {
    expect(
      buildManifest({ ...release, files: ["Ink.Writer_0.2.0_x64-setup.exe"], signatures: {} }),
    ).toBeNull();
  });
});
