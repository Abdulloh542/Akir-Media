const PLATFORMS = {
  youtube: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:[^&]*&)*v=[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?youtu\.be\/[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/[\w-]+/,
      /(?:https?:\/\/)?(?:m\.)?youtube\.com\/watch\?(?:[^&]*&)*v=[\w-]+/,
    ],
    name: 'YouTube',
    emoji: '🔴',
    supportsAudio: true,
    supportsVideo: true,
  },
  instagram: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/stories\/[\w.]+\/\d+/,
      /(?:https?:\/\/)?(?:www\.)?instagram\.com\/[\w.]+\/(?:p|reel|tv)\/[\w-]+/,
    ],
    name: 'Instagram',
    emoji: '📸',
    supportsImages: true,
    supportsVideo: true,
    needsCookies: true,
  },
  tiktok: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w.]+\/video\/\d+/,
      /(?:https?:\/\/)?vm\.tiktok\.com\/[\w]+/,
      /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/t\/[\w]+/,
      /(?:https?:\/\/)?vt\.tiktok\.com\/[\w]+/,
    ],
    name: 'TikTok',
    emoji: '🎵',
    supportsVideo: true,
  },
  facebook: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?facebook\.com\/.*\/videos\/\d+/,
      /(?:https?:\/\/)?(?:www\.)?fb\.watch\/[\w-]+/,
      /(?:https?:\/\/)?(?:www\.)?facebook\.com\/watch\/?\?v=\d+/,
      /(?:https?:\/\/)?(?:www\.)?facebook\.com\/reel\/\d+/,
      /(?:https?:\/\/)?(?:www\.)?facebook\.com\/share\/v\/[\w-]+/,
    ],
    name: 'Facebook',
    emoji: '📘',
    supportsVideo: true,
  },
  twitter: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?twitter\.com\/[\w]+\/status\/\d+/,
      /(?:https?:\/\/)?(?:www\.)?x\.com\/[\w]+\/status\/\d+/,
      /(?:https?:\/\/)?t\.co\/[\w]+/,
    ],
    name: 'Twitter/X',
    emoji: '🐦',
    supportsVideo: true,
    supportsImages: true,
  },
  pinterest: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?pinterest\.com\/pin\/\d+/,
      /(?:https?:\/\/)?pin\.it\/[\w]+/,
      /(?:https?:\/\/)?(?:[\w-]+\.)?pinterest\.com\/pin\/\d+/,
    ],
    name: 'Pinterest',
    emoji: '📌',
    supportsImages: true,
    supportsVideo: true,
  },
  vimeo: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/\d+/,
      /(?:https?:\/\/)?vimeo\.com\/channels\/[\w]+\/\d+/,
    ],
    name: 'Vimeo',
    emoji: '🎞',
    supportsVideo: true,
  },
  reddit: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?reddit\.com\/r\/[\w]+\/comments\/[\w]+/,
      /(?:https?:\/\/)?redd\.it\/[\w]+/,
      /(?:https?:\/\/)?(?:www\.)?reddit\.com\/media\?url=/,
    ],
    name: 'Reddit',
    emoji: '🟠',
    supportsVideo: true,
    supportsImages: true,
  },
  twitch: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?twitch\.tv\/[\w]+\/clip\/[\w-]+/,
      /(?:https?:\/\/)?clips\.twitch\.tv\/[\w-]+/,
    ],
    name: 'Twitch',
    emoji: '🟣',
    supportsVideo: true,
  },
  dailymotion: {
    patterns: [
      /(?:https?:\/\/)?(?:www\.)?dailymotion\.com\/video\/[\w]+/,
      /(?:https?:\/\/)?dai\.ly\/[\w]+/,
    ],
    name: 'Dailymotion',
    emoji: '🎬',
    supportsVideo: true,
  },
};

function detectPlatform(url) {
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    for (const pattern of platform.patterns) {
      if (pattern.test(url)) {
        return { key, ...platform };
      }
    }
  }
  return { key: 'unknown', name: 'Unknown', emoji: '🌐', supportsVideo: true };
}

function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s<>"\]]+/g;
  const matches = text.match(urlRegex);
  return matches || [];
}

function extractUrl(text) {
  const urls = extractUrls(text);
  return urls.length > 0 ? urls[0] : null;
}

module.exports = { detectPlatform, extractUrl, extractUrls, PLATFORMS };
