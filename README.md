Wymp SQL
=========================================================================================

This is a **very experimental** attempt at a fully generalized, customizable Typescript database
abstraction. While we made an intentional choice to move away from fully declarative method names
in favor of more generlized methods, in effect, they remain fairly specific, since you can't call
the methods without some fairly specific typing.

The central concept in this library is the "TypeMap". This is a type that you define that links
together string type-tags with actual database types, possible filters, possible constraints, and
possible default values for fields.

The best example of this can be found in the `tests` folder, specifically the
[`tests/Types.ts` file](tests/Types.ts). This file demonstrates the construction of a simple domain.
In reality, you would probably separate types from actual values (like `UserDefaults`, etc.), but in
this case, we've just lumped them all together for ease of use.

As you can see from that example, you have the option of defining constraints (for getting single
resources) and filters (for getting collections) on a per-resource basis. You can also define
default values (either hard-coded or function-based) for each resource type, allowing you to call
`save` for a new resource without having to provide fields for which reasonable defaults can be
found.

## Pitfalls

In order to remain useful in the real world, this library must strike a compromise between being
generic and also providing strict typing. This means that there are instances in which mistakes can
slip through the cracks and produce unexpected issues at runtime. These are not issues that we view
as resolvable, since doing so would make the library either too unwieldy or flat out incapable of
performing. Following is a running list of those issues:

* When overriding the `getSqlForFilterField` method, it is possible to return an array of values
  when you in fact want to return an array in an array. (TODO: further explain this error)

## To-Do

1. Document `TypeGen` module
2. Complete `SqlInterface` interface
3. Provide more examples of how to use this library

