import parallel from '../dist/index';
import assert from 'assert';

// --- Global counters for concurrency testing ---
let active_tasks = 0;
let max_concurrent_tasks = 0;
let task_execution_count = 0; // To ensure do_something is actually called (for TC2 and TC4)

// Modified do_something to track concurrency and execution
const do_something_tracked = async () => {
    task_execution_count++;
    active_tasks++;
    max_concurrent_tasks = Math.max(max_concurrent_tasks, active_tasks);
    // console.log(`Starting task. Active: ${active_tasks}, Max Concurrent: ${max_concurrent_tasks}, Count: ${task_execution_count}`);
    const timeout = Math.random() * 20 + 10; // Shorter timeout for faster tests
    let resultValue = "";
    try {
        await new Promise(resolve => setTimeout(resolve, timeout));
        resultValue = `task_slept_for_${timeout.toFixed(0)}`;
    } finally {
        active_tasks--;
        // console.log(`Finished task. Active: ${active_tasks}`);
    }
    return resultValue; 
};

const another_async_fixed_return = async () => {
    return await (async () => {
        return [true, "fixed_val"]; // Predictable return
    })();
};

const job_that_throws = async () => {
    await new Promise(resolve => setTimeout(resolve, 10)); // Short delay
    throw new Error("This is a test error");
};

const runTests = async () => {
    console.log("Starting tests...");

    // --- Test Case 1: Correctness of results and order ---
    console.log("Running Test Case 1: Correctness and Order");
    const jobs1 = [
        async () => Promise.resolve(100),
        async () => "test_string",
        another_async_fixed_return, // Use the modified version
        async () => Promise.resolve({ id: 1, status: "ok" }),
    ] as const;
    // Expected results need to match the actual return values of the functions in jobs1
    const expectedResults1 = [
        100, 
        "test_string", 
        await another_async_fixed_return(), // Call it to get the expected result
        { id: 1, status: "ok" }
    ];
    const results1 = await parallel(jobs1, 2); // Example limit of 2
    assert.deepStrictEqual(results1, expectedResults1, "Test Case 1 Failed: Results or order mismatch.");
    console.log("Test Case 1 Passed.");

    // --- Test Case 2: Concurrency limiting ---
    console.log("Running Test Case 2: Concurrency Limiting");
    active_tasks = 0;
    max_concurrent_tasks = 0;
    task_execution_count = 0;
    const num_jobs_tc2 = 8; 
    const limit_tc2 = 3;    
    const jobs2 = Array(num_jobs_tc2).fill(do_something_tracked);

    const results2 = await parallel(jobs2, limit_tc2);
    assert.strictEqual(results2.length, num_jobs_tc2, `Test Case 2 Failed: Not all jobs completed. Expected ${num_jobs_tc2}, got ${results2.length}`);
    assert(max_concurrent_tasks > 0, "Test Case 2 Failed: Max concurrent tasks was 0, expected > 0 (something should have run).");
    assert(max_concurrent_tasks <= limit_tc2, `Test Case 2 Failed: Max concurrent tasks (${max_concurrent_tasks}) exceeded limit (${limit_tc2}).`);
    assert.strictEqual(task_execution_count, num_jobs_tc2, `Test Case 2 Failed: Not all tasks were executed. Expected ${num_jobs_tc2}, got ${task_execution_count}`);
    results2.forEach((result, index) => {
        assert.ok(typeof result === 'string' && result.startsWith("task_slept_for_"), `Test Case 2 Failed: Result[${index}] format mismatch.`);
    });
    console.log(`Test Case 2 Passed. Max concurrent: ${max_concurrent_tasks} (Limit: ${limit_tc2}), Jobs: ${num_jobs_tc2}`);

    // --- Test Case 3: Empty job array ---
    console.log("Running Test Case 3: Empty Job Array");
    const jobs3: (() => Promise<any>)[] = [];
    const results3 = await parallel(jobs3, 5); // Limit can be anything
    assert.deepStrictEqual(results3, [], "Test Case 3 Failed: Result for empty job array should be an empty array.");
    console.log("Test Case 3 Passed.");

    // --- Test Case 4: Limit greater than job count ---
    console.log("Running Test Case 4: Limit Greater Than Job Count");
    active_tasks = 0;
    max_concurrent_tasks = 0;
    task_execution_count = 0; // Reset for this test case

    const job4A = async () => "jobA_result_tc4";
    const job4B_tracked = do_something_tracked; // The tracked function
    const job4C = async () => ({ detail: "jobC_detail_tc4" });
    
    const jobs4 = [job4A, job4B_tracked, job4C] as const;
    const limit_tc4 = 10; // Limit is higher than job count

    const results4 = await parallel(jobs4, limit_tc4);

    // Expected results:
    const expectedJob4AResult = await job4A();
    // For job4B_tracked, we check the format. The actual value is in results4[1]
    const expectedJob4CResult = await job4C();

    assert.strictEqual(results4.length, jobs4.length, `Test Case 4 Failed: Not all jobs completed. Expected ${jobs4.length}, got ${results4.length}`);
    assert.strictEqual(results4[0], expectedJob4AResult, "Test Case 4 Failed: Mismatch in result for job4A.");
    assert.ok(typeof results4[1] === 'string' && results4[1].startsWith("task_slept_for_"), "Test Case 4 Failed: Mismatch or unexpected format for do_something_tracked result.");
    assert.deepStrictEqual(results4[2], expectedJob4CResult, "Test Case 4 Failed: Mismatch in result for job4C.");
    
    assert(max_concurrent_tasks > 0, "Test Case 4 Failed: Max concurrent tasks was 0, expected > 0.");
    // Max concurrency should be at most the number of jobs if limit is higher
    assert(max_concurrent_tasks <= jobs4.length, `Test Case 4 Failed: Max concurrent tasks (${max_concurrent_tasks}) out of expected range (1-${jobs4.length}).`);
    assert.strictEqual(task_execution_count, 1, "Test Case 4 Failed: do_something_tracked was not executed exactly once for this test case.");
    console.log(`Test Case 4 Passed. Max concurrent: ${max_concurrent_tasks} (Limit: ${limit_tc4}, Jobs: ${jobs4.length})`);

    // --- Test Case 5: Error Handling ---
    console.log("Running Test Case 5: Error Handling");
    const jobs5 = [
        async () => { await new Promise(r => setTimeout(r, 5)); return "success1"; },
        job_that_throws,
        async () => { await new Promise(r => setTimeout(r, 20)); return "success2_should_not_run_or_be_returned"; } 
    ] as const;
    const expectedErrorMessage = "This is a test error";
    let caughtError = null;

    try {
        // Reset counters for this specific test if needed, though not strictly necessary for error testing logic itself
        active_tasks = 0;
        max_concurrent_tasks = 0;
        task_execution_count = 0; 
        console.log("   (Note: For TC5, the behavior of remaining tasks after an error depends on the library's design - typically it rejects fast.)");
        await parallel(jobs5, 2); // Limit 2
        assert.fail("Test Case 5 Failed: Expected parallel to throw an error, but it completed successfully.");
    } catch (error: any) {
        caughtError = error;
        assert(error instanceof Error, "Test Case 5 Failed: Caught error is not an instance of Error.");
        assert.strictEqual(error.message, expectedErrorMessage, `Test Case 5 Failed: Error message mismatch. Expected: "${expectedErrorMessage}", Got: "${error.message}"`);
        console.log("Test Case 5 Passed. Correctly caught expected error.");
    }
    // Depending on the library's behavior, you might also want to assert if other tasks were run or not.
    // For a fail-fast strategy, task_execution_count for do_something_tracked (if used here) might be low.
    // If job_that_throws was the first to be picked, others might not even start.
    // If we used do_something_tracked here, we could check task_execution_count.
    // For now, the primary check is that the error is thrown and caught.

    console.log("All tests passed!");
};

const run = (async () => {
    try {
        await runTests();
        console.log("Test suite finished successfully.");
    } catch (error) {
        console.error("Test suite failed:", error);
        process.exit(1); // Exit with error code if tests fail
    }
})

run()