"""
Demonstrate workflow execution including child workflow invocation.

Run the worker first:
    python worker.py

Then run this script:
    python main.py
"""

import asyncio
import os

from dotenv import load_dotenv
from polos import PolosClient

from workflows import (
    simple_workflow,
    data_pipeline,
    random_workflow,
    parent_workflow,
    orchestrator_workflow,
    # Pydantic payload models
    SimplePayload,
    DataPipelinePayload,
    RandomPayload,
    ParentPayload,
    OrchestratorPayload,
    ItemData,
)

load_dotenv()


async def run_workflow_demos():
    """Run various workflow demos."""
    project_id = os.getenv("POLOS_PROJECT_ID")
    if not project_id:
        raise ValueError(
            "POLOS_PROJECT_ID environment variable is required. "
            "Get it from the Polos UI at http://localhost:5173/projects/settings"
        )

    client = PolosClient(
        project_id=project_id,
        api_url=os.getenv("POLOS_API_URL", "http://localhost:8080"),
        deployment_id="workflow-basics-examples",
    )

    print("=" * 60)
    print("Workflow Basics Demo")
    print("=" * 60)

    # Demo 1: Simple workflow
    print("\n[Demo 1] Simple Workflow")
    print("-" * 40)
    print("Running simple_workflow with name='Alice'...")

    try:
        result = await simple_workflow.run(client, SimplePayload(name="Alice"))
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error: {e}")

    # Demo 2: Data pipeline with custom retry
    print("\n[Demo 2] Data Pipeline")
    print("-" * 40)
    print("Running data_pipeline with list of strings...")

    try:
        result = await data_pipeline.run(
            client,
            DataPipelinePayload(data=["hello", "world", "workflow"]),
        )
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error: {e}")

    # Demo 3: Random workflow (deterministic)
    print("\n[Demo 3] Random Workflow")
    print("-" * 40)
    print("Running random_workflow (coin flip)...")

    try:
        result = await random_workflow.run(client, RandomPayload())
        print(f"Result: {result}")
    except Exception as e:
        print(f"Error: {e}")

    # Demo 4: Parent workflow with child invocation
    print("\n[Demo 4] Parent Workflow with Child Workflows")
    print("-" * 40)
    print("Running parent_workflow that invokes validate_and_enrich for each item...")

    try:
        result = await parent_workflow.run(
            client,
            ParentPayload(
                items=[
                    ItemData(id=1, name="Item A", value=100),
                    ItemData(id=2, name="Item B", value=200),
                    ItemData(id=3, name="Item C", value=300),
                ]
            ),
        )
        print(f"Total items: {result.total_items}")
        print(f"Valid items: {result.valid_items}")
        print(f"Preparation: status={result.preparation.status}, count={result.preparation.item_count}")
        print("Child workflow results:")
        for i, r in enumerate(result.results):
            enriched_flag = r.enriched.get("_enriched") if r.enriched else None
            print(f"  Item {i+1}: valid={r.valid}, enriched={enriched_flag}")
    except Exception as e:
        print(f"Error: {e}")

    # Demo 5: Orchestrator workflow (sequential child calls)
    print("\n[Demo 5] Orchestrator Workflow")
    print("-" * 40)
    print("Running orchestrator_workflow that coordinates child workflows...")

    try:
        result = await orchestrator_workflow.run(
            client,
            OrchestratorPayload(
                data={"user_id": "user-123", "action": "signup", "email": "user@example.com"}
            ),
        )
        print(f"Status: {result.status}")
        print(f"Output ID: {result.output_id}")
        if result.enrichment:
            print(f"Enrichment valid: {result.enrichment.valid}")
        if result.processed:
            print(f"Processing applied: {result.processed.processing_applied}")
    except Exception as e:
        print(f"Error: {e}")

    print("\n" + "=" * 60)
    print("Demo complete!")
    print("=" * 60)


async def main():
    """Main entry point."""
    await run_workflow_demos()


if __name__ == "__main__":
    asyncio.run(main())
