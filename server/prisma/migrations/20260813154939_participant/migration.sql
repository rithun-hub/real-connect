-- CreateEnum
CREATE TYPE "ConnectionQuality" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DISCONNECTED');

-- CreateTable
CREATE TABLE "Participant" (
    "id" SERIAL NOT NULL,
    "meetingId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "cameraEnabled" BOOLEAN NOT NULL DEFAULT true,
    "screenSharing" BOOLEAN NOT NULL DEFAULT false,
    "handRaised" BOOLEAN NOT NULL DEFAULT false,
    "isCoHost" BOOLEAN NOT NULL DEFAULT false,
    "isSpeaking" BOOLEAN NOT NULL DEFAULT false,
    "connectionQuality" "ConnectionQuality" NOT NULL DEFAULT 'GOOD',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Participant_meetingId_idx" ON "Participant"("meetingId");

-- CreateIndex
CREATE INDEX "Participant_userId_idx" ON "Participant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_meetingId_userId_key" ON "Participant"("meetingId", "userId");

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
