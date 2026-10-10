/**
 * companyBranding.ts
 * Official Company Logo & Branding definitions for Mobile Invoices & Preview
 */

export const DEFAULT_COMPANY_LOGO = '';

export function getCompanyLogo(company?: { logo_url?: string } | null): string {
  if (company && typeof company.logo_url === 'string' && company.logo_url.trim().length > 0) {
    return company.logo_url.trim();
  }
  return '';
}
