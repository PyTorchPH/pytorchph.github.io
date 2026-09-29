from resume_builder.job_application import (
    BrowserResourceSnapshot,
    calculate_browser_resource_limits,
)


def test_swap_pressure_forces_one_worker_and_six_or_fewer_tabs():
    limits = calculate_browser_resource_limits(
        BrowserResourceSnapshot(
            total_memory_mib=7680,
            available_memory_mib=3200,
            swap_used_mib=1536,
            logical_cpus=8,
            physical_cores=4,
        ),
        requested_workers=3,
        requested_candidates=18,
    )

    assert limits.max_workers == 1
    assert limits.max_tabs <= 6
    assert limits.max_candidates == limits.max_tabs


def test_healthy_machine_still_honors_explicit_worker_tab_and_candidate_caps():
    limits = calculate_browser_resource_limits(
        BrowserResourceSnapshot(
            total_memory_mib=32768,
            available_memory_mib=24000,
            swap_used_mib=0,
            logical_cpus=16,
            physical_cores=8,
        ),
        requested_workers=3,
        requested_candidates=20,
        requested_tabs=8,
    )

    assert limits.max_workers == 3
    assert limits.max_tabs == 8
    assert limits.max_candidates == 8


def test_low_memory_never_disables_progress_entirely():
    limits = calculate_browser_resource_limits(
        BrowserResourceSnapshot(
            total_memory_mib=4096,
            available_memory_mib=900,
            swap_used_mib=0,
            logical_cpus=4,
            physical_cores=2,
        ),
        requested_workers=5,
        requested_candidates=12,
    )

    assert limits.max_workers == 1
    assert limits.max_tabs >= 2
    assert limits.max_candidates >= 1
