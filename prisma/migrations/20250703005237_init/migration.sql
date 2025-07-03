-- CreateEnum
CREATE TYPE "Status" AS ENUM ('pending', 'present', 'late', 'no_show');

-- CreateTable
CREATE TABLE "Agent" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "hash" TEXT,
    "phone" TEXT,
    "role" TEXT,
    "standbyFlag" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" SERIAL NOT NULL,
    "agentId" INTEGER,
    "shiftDate" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Duty" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Duty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceLog" (
    "id" SERIAL NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'pending',
    "checkIn" TIMESTAMP(3),
    "lunchStart" TIMESTAMP(3),
    "lunchEnd" TIMESTAMP(3),
    "overtimeStart" TIMESTAMP(3),
    "overtimeEnd" TIMESTAMP(3),
    "dutyId" INTEGER,
    "updatedBy" INTEGER,

    CONSTRAINT "AttendanceLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeForecast" (
    "id" SERIAL NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "expectedCalls" INTEGER NOT NULL,
    "expectedTickets" INTEGER NOT NULL,

    CONSTRAINT "VolumeForecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VolumeActual" (
    "id" SERIAL NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "calls" INTEGER NOT NULL,
    "tickets" INTEGER NOT NULL,

    CONSTRAINT "VolumeActual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "table" TEXT NOT NULL,
    "recordId" INTEGER NOT NULL,
    "delta" JSONB NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_email_key" ON "Agent"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Duty_name_key" ON "Duty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceLog_shiftId_key" ON "AttendanceLog"("shiftId");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceLog" ADD CONSTRAINT "AttendanceLog_dutyId_fkey" FOREIGN KEY ("dutyId") REFERENCES "Duty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
