import React from 'react';
import { CreditCard, Globe, Landmark, Wallet, type LucideIcon } from 'lucide-react';
import { PAYMENT_BRAND_ICONS } from '../assets/payment-icons/index';
import { getPaymentMethod } from '../shared/paymentMethods';

const GENERIC_ICONS: Record<string, LucideIcon> = {
  landmark: Landmark,
  globe: Globe,
  'credit-card': CreditCard,
};

interface PaymentIconProps {
  /** Payment method type from src/shared/paymentMethods.ts; unknown types show a wallet. */
  type: string;
  size?: number;
  className?: string;
}

// Decorative icon for a payment method (update.md §4): brand marks from Simple Icons in their listed
// colour, lucide for the generic types. The method name is always shown as text next to it.
export const PaymentIcon: React.FC<PaymentIconProps> = ({ type, size = 24, className }) => {
  const iconKey = getPaymentMethod(type)?.iconKey ?? '';
  const brand = PAYMENT_BRAND_ICONS[iconKey];
  if (brand) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={brand.color}
        aria-hidden="true"
        focusable="false"
      >
        <path d={brand.path} />
      </svg>
    );
  }
  const Icon = GENERIC_ICONS[iconKey] ?? Wallet;
  return <Icon className={className} size={size} aria-hidden="true" focusable="false" />;
};

export default PaymentIcon;
