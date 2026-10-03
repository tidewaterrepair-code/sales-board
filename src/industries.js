'use strict';

// High-demand local niches the team prospects. `query` is what we send to
// Google Places text search; `customer` is the word used in scripts.
const INDUSTRIES = [
  { key: 'hvac', label: 'HVAC', emoji: '❄️', query: 'HVAC contractor', trade: 'HVAC', customer: 'customers', avgTicket: 450 },
  { key: 'plumber', label: 'Plumbers', emoji: '🚿', query: 'plumber', trade: 'plumbing', customer: 'customers', avgTicket: 350 },
  { key: 'roofer', label: 'Roofers', emoji: '🏠', query: 'roofing contractor', trade: 'roofing', customer: 'homeowners', avgTicket: 8500 },
  { key: 'electrician', label: 'Electricians', emoji: '⚡', query: 'electrician', trade: 'electrical', customer: 'customers', avgTicket: 400 },
  { key: 'dentist', label: 'Dentists', emoji: '🦷', query: 'dentist', trade: 'dental', customer: 'patients', avgTicket: 300 },
  { key: 'chiropractor', label: 'Chiropractors', emoji: '🦴', query: 'chiropractor', trade: 'chiropractic', customer: 'patients', avgTicket: 120 },
  { key: 'med_spa', label: 'Med Spas', emoji: '💉', query: 'med spa', trade: 'med spa', customer: 'clients', avgTicket: 450 },
  { key: 'salon', label: 'Hair & Nail Salons', emoji: '💇', query: 'hair salon', trade: 'salon', customer: 'clients', avgTicket: 90 },
  { key: 'auto_repair', label: 'Auto Repair', emoji: '🔧', query: 'auto repair shop', trade: 'auto repair', customer: 'customers', avgTicket: 550 },
  { key: 'landscaping', label: 'Landscaping & Lawn', emoji: '🌳', query: 'landscaping company', trade: 'landscaping', customer: 'customers', avgTicket: 600 },
  { key: 'cleaning', label: 'Cleaning Services', emoji: '🧽', query: 'house cleaning service', trade: 'cleaning', customer: 'clients', avgTicket: 180 },
  { key: 'pest_control', label: 'Pest Control', emoji: '🐜', query: 'pest control', trade: 'pest control', customer: 'customers', avgTicket: 250 },
  { key: 'lawyer', label: 'Law Firms', emoji: '⚖️', query: 'personal injury lawyer', trade: 'legal', customer: 'clients', avgTicket: 3500 },
  { key: 'real_estate', label: 'Real Estate Agents', emoji: '🏡', query: 'real estate agent', trade: 'real estate', customer: 'buyers and sellers', avgTicket: 9000 },
  { key: 'gym', label: 'Gyms & Studios', emoji: '🏋️', query: 'gym', trade: 'fitness', customer: 'members', avgTicket: 70 },
  { key: 'restaurant', label: 'Restaurants', emoji: '🍔', query: 'restaurant', trade: 'restaurant', customer: 'guests', avgTicket: 45 },
  { key: 'veterinarian', label: 'Veterinarians', emoji: '🐾', query: 'veterinarian', trade: 'veterinary', customer: 'pet owners', avgTicket: 220 },
  { key: 'contractor', label: 'General Contractors', emoji: '🔨', query: 'general contractor', trade: 'remodeling', customer: 'homeowners', avgTicket: 12000 },
];

const BY_KEY = Object.fromEntries(INDUSTRIES.map((i) => [i.key, i]));

function getIndustry(key) {
  return BY_KEY[key] || { key: 'other', label: 'Local Business', emoji: '🏪', query: key || 'business', trade: 'local', customer: 'customers', avgTicket: 250 };
}

module.exports = { INDUSTRIES, getIndustry };
