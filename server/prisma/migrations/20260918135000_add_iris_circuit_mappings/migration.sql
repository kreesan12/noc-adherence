ALTER TABLE "Circuit"
  ADD COLUMN "iris_graph_a_id" TEXT,
  ADD COLUMN "iris_graph_b_id" TEXT,
  ADD COLUMN "iris_graph_a_label" TEXT,
  ADD COLUMN "iris_graph_b_label" TEXT,
  ADD COLUMN "iris_graph_a_device" TEXT,
  ADD COLUMN "iris_graph_b_device" TEXT,
  ADD COLUMN "iris_mapping_updated_at" TIMESTAMP(3);

CREATE INDEX "idx_circuit_iris_graph_a_id" ON "Circuit"("iris_graph_a_id");
CREATE INDEX "idx_circuit_iris_graph_b_id" ON "Circuit"("iris_graph_b_id");
