package de.hbt.power.profile.data;

import de.hbt.power.profile.model.profile.NameEntityType;
import de.hbt.power.profile.model.profile.entries.NameEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;

public interface NameEntityRepository extends JpaRepository<NameEntity, Long> {
    NameEntity findByName(String name);

    NameEntity findByNameAndType(String name, NameEntityType type);

    Collection<NameEntity> findAllByType(NameEntityType type);
}
