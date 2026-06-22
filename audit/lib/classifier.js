// Bucket classification — decides which sales angle a lead gets, based purely on
// Module 1 (deterministic) findings. Never uses subjective vision findings, so the
// result is reproducible and explainable.

const DIY_PLATFORMS = new Set(['wix', 'godaddy', 'squarespace', 'weebly']);

export function classifyLead(findings) {
  const { domain_type, platform } = findings;

  const isBuilderPlatform = DIY_PLATFORMS.has(platform);
  const isBuilderSubdomain = domain_type === 'builder_subdomain';

  if (isBuilderSubdomain && isBuilderPlatform) {
    return {
      bucket: 'diy-builder',
      confidence: 'high',
      reason: `builder subdomain on ${platform}, no custom domain`
    };
  }

  if (isBuilderPlatform && domain_type === 'custom_domain') {
    return {
      bucket: 'diy-builder',
      confidence: 'medium',
      reason: `custom domain but built on ${platform}, a consumer builder`
    };
  }

  if (platform === 'wordpress' && domain_type === 'custom_domain') {
    return {
      bucket: 'pro-maintained',
      confidence: 'high',
      reason: 'custom domain on WordPress — typically designer-built and retainer-maintained'
    };
  }

  if (platform === 'custom' && domain_type === 'custom_domain') {
    return {
      bucket: 'pro-maintained',
      confidence: 'medium',
      reason: 'custom domain with no consumer-builder signature — likely a custom build'
    };
  }

  return {
    bucket: 'unknown',
    confidence: 'low',
    reason: 'signals conflicting or insufficient to classify confidently'
  };
}
