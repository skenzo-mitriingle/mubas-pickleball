const DIRECT_VIDEO_EXTENSION_PATTERN = /\.(mp4|webm|ogg|ogv|m4v|mov)(?:$|[?#])/i;

function toUrl(value) {
  const trimmedValue = typeof value === "string" ? value.trim() : "";

  if (!trimmedValue) {
    return null;
  }

  try {
    return new URL(trimmedValue);
  } catch (error) {
    try {
      return new URL(`https://${trimmedValue}`);
    } catch (nestedError) {
      return null;
    }
  }
}

function getCleanHost(url) {
  return url.hostname.replace(/^www\./i, "").toLowerCase();
}

function extractYouTubeId(url) {
  const host = getCleanHost(url);
  const pathSegments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return pathSegments[0] || "";
  }

  if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    if (pathSegments[0] === "watch") {
      return url.searchParams.get("v") || "";
    }

    if (pathSegments[0] === "embed" || pathSegments[0] === "shorts") {
      return pathSegments[1] || "";
    }
  }

  return "";
}

function extractVimeoId(url) {
  const host = getCleanHost(url);

  if (!host.endsWith("vimeo.com")) {
    return "";
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);

  for (let index = pathSegments.length - 1; index >= 0; index -= 1) {
    if (/^\d+$/.test(pathSegments[index])) {
      return pathSegments[index];
    }
  }

  return "";
}

function getMimeType(url) {
  const extensionMatch = url.pathname.match(DIRECT_VIDEO_EXTENSION_PATTERN);

  if (!extensionMatch) {
    return "video/mp4";
  }

  const extension = extensionMatch[1].toLowerCase();

  if (extension === "webm") {
    return "video/webm";
  }

  if (extension === "ogg" || extension === "ogv") {
    return "video/ogg";
  }

  if (extension === "mov") {
    return "video/quicktime";
  }

  return "video/mp4";
}

export function getVideoProviderLabel(provider) {
  if (provider === "youtube") {
    return "YouTube";
  }

  if (provider === "vimeo") {
    return "Vimeo";
  }

  if (provider === "direct") {
    return "Direct Video";
  }

  return "Video";
}

export function normalizeVideoSource(value) {
  const url = toUrl(value);

  if (!url) {
    return {
      isValid: false,
      error: "Use a valid YouTube, Vimeo, or direct video link."
    };
  }

  const cleanHost = getCleanHost(url);
  const youTubeId = extractYouTubeId(url);

  if (youTubeId) {
    return {
      isValid: true,
      provider: "youtube",
      providerLabel: getVideoProviderLabel("youtube"),
      kind: "iframe",
      sourceUrl: `https://www.youtube.com/watch?v=${youTubeId}`,
      embedUrl: `https://www.youtube.com/embed/${youTubeId}?rel=0&modestbranding=1`
    };
  }

  const vimeoId = extractVimeoId(url);

  if (vimeoId) {
    return {
      isValid: true,
      provider: "vimeo",
      providerLabel: getVideoProviderLabel("vimeo"),
      kind: "iframe",
      sourceUrl: `https://vimeo.com/${vimeoId}`,
      embedUrl: `https://player.vimeo.com/video/${vimeoId}`
    };
  }

  if (DIRECT_VIDEO_EXTENSION_PATTERN.test(url.pathname)) {
    return {
      isValid: true,
      provider: "direct",
      providerLabel: getVideoProviderLabel("direct"),
      kind: "direct",
      sourceUrl: url.toString(),
      embedUrl: "",
      mimeType: getMimeType(url)
    };
  }

  if (cleanHost) {
    return {
      isValid: false,
      error: "Only YouTube, Vimeo, or direct .mp4, .webm, .ogg, .ogv, .m4v, .mov links are supported."
    };
  }

  return {
    isValid: false,
    error: "Use a valid YouTube, Vimeo, or direct video link."
  };
}

export function normalizeStoredVideo(item) {
  if (!item) {
    return {
      isValid: false,
      error: "This video item is missing."
    };
  }

  const provider = typeof item.provider === "string" ? item.provider : "";
  const sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl : "";
  const embedUrl = typeof item.embedUrl === "string" ? item.embedUrl : "";

  if (provider && (sourceUrl || embedUrl)) {
    let mimeType = "";

    if (provider === "direct" && sourceUrl) {
      try {
        mimeType = getMimeType(new URL(sourceUrl));
      } catch (error) {
        mimeType = "video/mp4";
      }
    }

    return {
      isValid: true,
      provider,
      providerLabel: getVideoProviderLabel(provider),
      kind: provider === "direct" ? "direct" : "iframe",
      sourceUrl,
      embedUrl,
      mimeType
    };
  }

  return normalizeVideoSource(sourceUrl || embedUrl || item.videoUrl || "");
}

export function getVideoAction(item) {
  const source = normalizeStoredVideo(item);

  if (!source.isValid || !source.sourceUrl) {
    return {
      href: "",
      label: "Open Video"
    };
  }

  if (source.provider === "youtube") {
    return {
      href: source.sourceUrl,
      label: "Watch on YouTube"
    };
  }

  if (source.provider === "vimeo") {
    return {
      href: source.sourceUrl,
      label: "Watch on Vimeo"
    };
  }

  return {
    href: source.sourceUrl,
    label: "Open Video"
  };
}

export function createVideoMediaElement(item, options = {}) {
  const {
    frameClass = "video-frame",
    mediaClass = "video-embed",
    title = item?.title || "Club video",
    lazy = true
  } = options;
  const source = normalizeStoredVideo(item);
  const frame = document.createElement("div");

  frame.className = frameClass;

  if (!source.isValid) {
    const fallback = document.createElement("div");
    fallback.className = `${frameClass} video-frame-fallback`;
    fallback.textContent = "This video link is not supported yet.";
    frame.appendChild(fallback);
    return frame;
  }

  if (source.kind === "iframe" && source.embedUrl) {
    const iframe = document.createElement("iframe");
    iframe.className = mediaClass;
    iframe.src = source.embedUrl;
    iframe.title = title;
    iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    iframe.allowFullscreen = true;

    if (lazy) {
      iframe.loading = "lazy";
    }

    frame.appendChild(iframe);
    return frame;
  }

  if (source.kind === "direct" && source.sourceUrl) {
    const video = document.createElement("video");
    const sourceElement = document.createElement("source");

    video.className = mediaClass;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    sourceElement.src = source.sourceUrl;
    sourceElement.type = source.mimeType || "video/mp4";
    video.appendChild(sourceElement);
    frame.appendChild(video);
    return frame;
  }

  const fallbackLink = document.createElement("a");
  fallbackLink.href = source.sourceUrl || "#";
  fallbackLink.target = "_blank";
  fallbackLink.rel = "noreferrer";
  fallbackLink.textContent = "Open Video";
  frame.appendChild(fallbackLink);
  return frame;
}
