-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "Meeting" (
    "id" SERIAL NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" TEXT,
    "hostId" INTEGER NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "maxParticipants" INTEGER NOT NULL DEFAULT 10,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "screenSharingAllowed" BOOLEAN NOT NULL DEFAULT true,
    "chatAllowed" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_roomId_key" ON "Meeting"("roomId");

-- CreateIndex
CREATE INDEX "Meeting_hostId_idx" ON "Meeting"("hostId");

-- CreateIndex
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
