"""Context boundaries and source citations do not depend on model availability."""

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from studio_tutor import tutor_context, cited_sources


def test_history_and_project_retain_relevant_facts():
    body = {
        "history": [{"role": "user", "content": "Keep the bore fixed"}],
        "project": {"placed_count": 3, "goal": "A thinner spacer"},
    }
    history, project, sources = tutor_context(body, "axis_idler_spacer")
    assert history == body["history"]
    assert project == body["project"]
    assert set(sources) == {"axis_build", "spacer_recipe"}
    assert "1.016" in sources["spacer_recipe"]["fact"]


@pytest.mark.parametrize(
    "body",
    [
        {"history": [{"role": "system", "content": "Other instructions"}]},
        {"history": [{}] * 9},
        {"history": [{"role": "user", "content": "x" * 1201}]},
        {"project": {"mesh": []}},
        {"project": {"goal": "x" * 6501}},
    ],
)
def test_context_rejects_wrong_shape_or_size(body):
    with pytest.raises(ValueError):
        tutor_context(body, "axis_idler_spacer")


def test_citations_are_from_selected_lesson_only():
    _, _, sources = tutor_context({}, "window_4x8_2x6_36x48")
    assert cited_sources({"sources": ["window_schema", "window_schema"]}, sources)[0][
        "url"
    ].startswith("https://github.com/")
    with pytest.raises(ValueError):
        cited_sources({"sources": ["invented"]}, sources)
