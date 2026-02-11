import { useNavigate } from "react-router-dom";
import { DropZone } from "@/ui/components/DropZone";
import { useAppState } from "../state/AppState";

export function Home() {
  const navigate = useNavigate();
  const { setFile } = useAppState();

  const handleFile = (file: File) => {
    setFile(file);
    navigate("/listen");
  };

  return (
    <section className="panel">
      <DropZone onFile={handleFile} accept="audio/*" />
    </section>
  );
}
