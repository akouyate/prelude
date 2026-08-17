-- AlterTable
ALTER TABLE "CreditLot" ADD COLUMN     "billingCountry" TEXT;

-- AlterTable
ALTER TABLE "CreditWallet" ADD COLUMN     "settlementCurrency" TEXT;

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN     "locale" TEXT;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "country" TEXT;
