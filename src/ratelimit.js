// Har bir foydalanuvchi uchun request rate limiter
const userCooldowns = new Map();
const userActiveJobs = new Map();

const COOLDOWN_MS = 5000;       // 5 sekund kutish
const MAX_ACTIVE_JOBS = 3;      // Bir vaqtda maksimum 3 ta job per user

function isOnCooldown(userId) {
  const lastTime = userCooldowns.get(userId);
  if (!lastTime) return false;
  return Date.now() - lastTime < COOLDOWN_MS;
}

function setCooldown(userId) {
  userCooldowns.set(userId, Date.now());
}

function getActiveJobs(userId) {
  return userActiveJobs.get(userId) || 0;
}

function incrementJobs(userId) {
  userActiveJobs.set(userId, (userActiveJobs.get(userId) || 0) + 1);
}

function decrementJobs(userId) {
  const current = userActiveJobs.get(userId) || 0;
  if (current <= 1) {
    userActiveJobs.delete(userId);
  } else {
    userActiveJobs.set(userId, current - 1);
  }
}

function canUserDownload(userId) {
  if (isOnCooldown(userId)) {
    return { allowed: false, reason: 'cooldown' };
  }
  if (getActiveJobs(userId) >= MAX_ACTIVE_JOBS) {
    return { allowed: false, reason: 'too_many_jobs' };
  }
  return { allowed: true };
}

module.exports = {
  canUserDownload,
  setCooldown,
  incrementJobs,
  decrementJobs,
  COOLDOWN_MS,
  MAX_ACTIVE_JOBS,
};
