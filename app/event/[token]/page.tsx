import AttendancePage from "@/components/attendance/AttendancePage";
import { attendanceFormTexts } from "@/lib/legalContent";

// The public attendance form participants open from the QR code. The
// participation terms and data processing texts come from legal/ (rendered
// here, on the server).
export default function EventPage() {
  return <AttendancePage texts={attendanceFormTexts()} />;
}
