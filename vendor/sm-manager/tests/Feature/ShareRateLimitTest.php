<?php

test('the public share route is rate limited', function () {
    // The throttle middleware counts every hit regardless of the controller
    // outcome; the 31st request within the window is rejected.
    for ($i = 0; $i < 30; $i++) {
        $this->get('/share/does-not-exist');
    }

    $this->get('/share/does-not-exist')->assertStatus(429);
});
